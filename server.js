const express=require("express");
const http=require("http");
const path=require("path");
const fs=require("fs");
const crypto=require("crypto");
const jwt=require("jsonwebtoken");
const multer=require("multer");
const {Server}=require("socket.io");

const app=express(), server=http.createServer(app), io=new Server(server);
const PORT=process.env.PORT||3000;
const SECRET=process.env.JWT_SECRET||"qingfeng-v11-local-secret";
const DATA=path.join(__dirname,"data.json"), UP=path.join(__dirname,"uploads");
fs.mkdirSync(UP,{recursive:true});

let db={users:[],friends:[],messages:[]};
function load(){try{if(fs.existsSync(DATA))db=JSON.parse(fs.readFileSync(DATA,"utf8"))}catch(e){console.error("数据库读取失败:",e.message)}}
function save(){const tmp=DATA+".tmp";fs.writeFileSync(tmp,JSON.stringify(db,null,2));fs.renameSync(tmp,DATA)}
load();

app.use(express.json({limit:"2mb"}));
app.use("/uploads",express.static(UP));
app.use(express.static(path.join(__dirname,"public")));

function hash(p){return crypto.createHash("sha256").update(String(p)+"|"+SECRET).digest("hex")}
function safe(u){return {id:u.id,username:u.username,nickname:u.nickname,avatar:u.avatar||""}}
function token(u){return jwt.sign({id:u.id,username:u.username},SECRET,{expiresIn:"7d"})}
function auth(req,res,next){try{const t=(req.headers.authorization||"").replace(/^Bearer\s+/,"");req.user=jwt.verify(t,SECRET);next()}catch(e){res.status(401).json({error:"登录已过期，请重新登录"})}}
function uid(){return db.users.length?Math.max(...db.users.map(x=>x.id))+1:1}
function areFriends(a,b){return db.friends.some(f=>f.status==="accepted"&&((f.a===a&&f.b===b)||(f.a===b&&f.b===a)))}

app.get("/api/health",(req,res)=>res.json({ok:true,users:db.users.length}));

app.post("/api/register",(req,res)=>{
  try{
    const username=String(req.body.username||"").trim();
    const password=String(req.body.password||"");
    const nickname=String(req.body.nickname||username).trim()||username;
    if(!/^[A-Za-z0-9_]{3,20}$/.test(username))return res.status(400).json({error:"账号需为3-20位字母、数字或下划线"});
    if(password.length<6)return res.status(400).json({error:"密码至少需要6位"});
    if(db.users.some(u=>u.username.toLowerCase()===username.toLowerCase()))return res.status(400).json({error:"账号已经存在，请换一个账号"});
    const u={id:uid(),username,password:hash(password),nickname,avatar:"",createdAt:new Date().toISOString()};
    db.users.push(u);save();
    console.log("注册成功:",username);
    res.json({token:token(u),user:safe(u)});
  }catch(e){console.error("注册错误:",e);res.status(500).json({error:"服务器注册失败："+e.message})}
});

app.post("/api/login",(req,res)=>{
  try{
    const username=String(req.body.username||"").trim(), password=String(req.body.password||"");
    const u=db.users.find(x=>x.username.toLowerCase()===username.toLowerCase()&&x.password===hash(password));
    if(!u)return res.status(401).json({error:"账号或密码错误"});
    res.json({token:token(u),user:safe(u)});
  }catch(e){res.status(500).json({error:"登录失败"})}
});

app.get("/api/me",auth,(req,res)=>{const u=db.users.find(x=>x.id===req.user.id);if(!u)return res.status(404).json({error:"用户不存在"});res.json({user:safe(u)})});

app.get("/api/users/search",auth,(req,res)=>{
  const q=String(req.query.q||"").toLowerCase().trim();
  if(!q)return res.json([]);
  res.json(db.users.filter(u=>u.id!==req.user.id&&(u.username.toLowerCase().includes(q)||u.nickname.toLowerCase().includes(q))).slice(0,20).map(safe));
});

app.post("/api/friends/request",auth,(req,res)=>{
  const b=Number(req.body.friendId), target=db.users.find(u=>u.id===b);
  if(!target||b===req.user.id)return res.status(400).json({error:"用户不存在"});
  if(areFriends(req.user.id,b))return res.status(400).json({error:"你们已经是好友"});
  const existing=db.friends.find(f=>f.a===req.user.id&&f.b===b);
  if(existing)return res.status(400).json({error:"好友申请已经发送"});
  const reverse=db.friends.find(f=>f.a===b&&f.b===req.user.id&&f.status==="pending");
  if(reverse){reverse.status="accepted";db.friends.push({a:req.user.id,b,status:"accepted"});save();io.to("u"+b).emit("friend:accepted",{user:safe(db.users.find(u=>u.id===req.user.id))});return res.json({ok:true,accepted:true})}
  db.friends.push({a:req.user.id,b,status:"pending"});save();
  io.to("u"+b).emit("friend:request");
  res.json({ok:true});
});

app.get("/api/friends",auth,(req,res)=>{
  const ids=db.friends.filter(f=>f.status==="accepted"&&(f.a===req.user.id||f.b===req.user.id)).map(f=>f.a===req.user.id?f.b:f.a);
  res.json(db.users.filter(u=>ids.includes(u.id)).map(safe));
});

app.get("/api/friend-requests",auth,(req,res)=>{
  const arr=db.friends.filter(f=>f.b===req.user.id&&f.status==="pending").map(f=>({requestId:f.a,user:safe(db.users.find(u=>u.id===f.a))}));
  res.json(arr);
});

app.post("/api/friends/accept",auth,(req,res)=>{
  const a=Number(req.body.requestId), f=db.friends.find(x=>x.a===a&&x.b===req.user.id&&x.status==="pending");
  if(!f)return res.status(404).json({error:"好友申请不存在"});
  f.status="accepted";db.friends.push({a:req.user.id,b:a,status:"accepted"});save();
  io.to("u"+a).emit("friend:accepted",{user:safe(db.users.find(u=>u.id===req.user.id))});
  res.json({ok:true});
});

app.get("/api/messages/:id",auth,(req,res)=>{
  const id=Number(req.params.id);
  if(!areFriends(req.user.id,id))return res.status(403).json({error:"你们还不是好友"});
  res.json(db.messages.filter(m=>(m.sender===req.user.id&&m.receiver===id)||(m.sender===id&&m.receiver===req.user.id)).slice(-500));
});

const upload=multer({storage:multer.diskStorage({destination:UP,filename:(req,file,cb)=>cb(null,Date.now()+"-"+crypto.randomBytes(5).toString("hex")+path.extname(file.originalname).toLowerCase())}),limits:{fileSize:8*1024*1024},fileFilter:(req,f,cb)=>cb(null,/^image\/(png|jpeg|jpg|gif|webp)$/.test(f.mimetype))});
app.post("/api/upload",auth,upload.single("image"),(req,res)=>{if(!req.file)return res.status(400).json({error:"请选择有效图片"});res.json({url:"/uploads/"+req.file.filename})});

app.post("/api/messages",auth,(req,res)=>{
  const receiver=Number(req.body.receiverId), type=req.body.type==="image"?"image":"text", content=String(req.body.content||"");
  if(!receiver||!content)return res.status(400).json({error:"消息不能为空"});
  if(!areFriends(req.user.id,receiver))return res.status(403).json({error:"你们还不是好友"});
  const m={id:db.messages.length?Math.max(...db.messages.map(x=>x.id))+1:1,sender:req.user.id,receiver,type,content,time:new Date().toISOString()};
  db.messages.push(m);save();io.to("u"+receiver).emit("message:new",m);io.to("u"+req.user.id).emit("message:new",m);res.json(m);
});

io.use((socket,next)=>{try{socket.user=jwt.verify(socket.handshake.auth.token,SECRET);next()}catch(e){next(new Error("unauthorized"))}});
io.on("connection",s=>s.join("u"+s.user.id));

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
server.listen(PORT,"0.0.0.0",()=>console.log("\\n清风聊天 V1.1 已启动：http://localhost:"+PORT+"\\n"));
