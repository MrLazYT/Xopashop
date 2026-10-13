import express from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

try { process.loadEnvFile?.('.env') } catch {}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const dataFile = path.join(root, 'data', 'store.json')
const uploadsDir = path.join(root, 'uploads')
const app = express()
const PORT = Number(process.env.PORT || 8787)
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || ''
const ADMIN_KEY = process.env.ADMIN_KEY || ''
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || ''
const CHANNEL_ID = String(process.env.TELEGRAM_CHANNEL_ID || '')

await fs.mkdir(uploadsDir,{recursive:true})
app.use(express.json({ limit: '12mb' }))
app.use('/uploads',express.static(uploadsDir))
app.use((req,res,next)=>{
  res.setHeader('Access-Control-Allow-Origin','*')
  res.setHeader('Access-Control-Allow-Headers','Content-Type,X-Admin-Key,Authorization')
  res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,PUT,DELETE,OPTIONS')
  if(req.method==='OPTIONS') return res.sendStatus(204)
  next()
})

// SQLite is the only writable source of truth. Import legacy JSON once.
const db = new DatabaseSync(path.join(root,'data','xopashop.sqlite'))
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id));
  CREATE INDEX IF NOT EXISTS records_kind ON records(kind);
  CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`)
const kinds=['users','sessions','orders','products','reviews','about','hopamats']
const count=db.prepare('SELECT COUNT(*) AS n FROM records').get().n
if(count===0){
  try {
    const previous=JSON.parse(await fs.readFile(dataFile,'utf8'))
    const put=db.prepare('INSERT OR REPLACE INTO records(kind,id,body) VALUES(?,?,?)')
    db.exec('BEGIN IMMEDIATE')
    for(const kind of kinds) for(const row of previous[kind]||[]) put.run(kind,String(row.id||row.token),JSON.stringify(row))
    db.exec('COMMIT')
    console.log('Imported legacy JSON data into SQLite')
  } catch(e){db.exec('ROLLBACK'); console.error('SQLite import failed',e); throw e}
}
function readStore(){
  const s=Object.fromEntries(kinds.map(k=>[k,[]]))
  for(const row of db.prepare('SELECT kind,body FROM records').all()) s[row.kind].push(JSON.parse(row.body))
  return s
}
const replaceAll=db.prepare('DELETE FROM records')
const insertRecord=db.prepare('INSERT INTO records(kind,id,body) VALUES(?,?,?)')
function writeStore(s){
  db.exec('BEGIN IMMEDIATE')
  try {
    replaceAll.run()
    for(const kind of kinds) for(const row of s[kind]||[]) insertRecord.run(kind,String(row.id||row.token),JSON.stringify(row))
    db.exec('COMMIT')
  }catch(e){db.exec('ROLLBACK');throw e}
}
async function notifyTelegram(text){
  if(!BOT_TOKEN || !ADMIN_CHAT_ID) return { skipped:true }
  const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:ADMIN_CHAT_ID,text,parse_mode:'HTML',disable_web_page_preview:true})})
  return r.json()
}
function code(prefix='XOPA'){ return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}` }
function slugify(v){ return String(v||'product').toLowerCase().trim().replace(/[^a-z0-9а-яіїєґ]+/gi,'-').replace(/^-|-$/g,'').slice(0,70)||crypto.randomBytes(3).toString('hex') }
function requireAdmin(req,res,next){ if(!ADMIN_KEY || req.header('x-admin-key')!==ADMIN_KEY) return res.status(401).json({error:'admin key required'}); next() }
function passwordHash(password,salt){ return crypto.scryptSync(String(password),salt,64).toString('hex') }
function makePassword(password){ const salt=crypto.randomBytes(16).toString('hex'); return {salt,hash:passwordHash(password,salt)} }
function verifyPassword(password,user){ const got=Buffer.from(passwordHash(password,user.passwordSalt),'hex'); const expected=Buffer.from(user.passwordHash,'hex'); return got.length===expected.length && crypto.timingSafeEqual(got,expected) }
function bearer(req){ const h=req.header('authorization')||''; return h.startsWith('Bearer ')?h.slice(7):'' }
async function currentUser(req){ const token=bearer(req); if(!token)return null; const s=await readStore(); const session=s.sessions.find(x=>x.token===token); if(!session)return null; return s.users.find(x=>x.id===session.userId)||null }
async function requireUser(req,res,next){ const user=await currentUser(req); if(!user)return res.status(401).json({error:'auth required'}); req.user=user; next() }
function publicUser(u){ return {id:u.id,username:u.username,displayName:u.displayName||'',telegram:u.telegram||'',createdAt:u.createdAt,savedDestinations:u.savedDestinations||[]} }
function normalizeProduct(raw,existing={}){
  return {
    ...existing,
    id: existing.id || raw.id || `${slugify(raw.title)}-${crypto.randomBytes(2).toString('hex')}`,
    title:String(raw.title||existing.title||'').slice(0,120),
    department:['visuals','giveaways','products','resource-packs','pvp','other'].includes(raw.department)?raw.department:(existing.department||'products'),
    price:Math.max(0,Number(raw.price??existing.price??0)),
    oldPrice: raw.oldPrice===''||raw.oldPrice==null?undefined:Number(raw.oldPrice),
    unit:String(raw.unit||existing.unit||'діямантів').slice(0,30),
    badge:String(raw.badge||'').slice(0,30)||undefined,
    isNew:raw.isNew??existing.isNew??true,
    createdAt:existing.createdAt||raw.createdAt||new Date().toISOString(),
    description:String(raw.description||existing.description||'').slice(0,3000),
    image:String(raw.image||existing.image||'').slice(0,2000),
    stock:Math.max(0,Number(raw.stock??existing.stock??0)),
    game:String(raw.game||existing.game||'').slice(0,80),
    details:Array.isArray(raw.details)?raw.details.map(x=>String(x).slice(0,500)).slice(0,30):(existing.details||[]),
    clarifications:Array.isArray(raw.clarifications)?raw.clarifications.map(x=>String(x).slice(0,700)).slice(0,30):(existing.clarifications||[])
  }
}

app.get('/api/health',(_,res)=>res.json({ok:true,time:new Date().toISOString()}))

app.post('/api/auth/register',async(req,res)=>{
  const {username,password,telegram='',displayName=''}=req.body||{}
  const name=String(username||'').trim()
  if(name.length<2||String(password||'').length<6) return res.status(400).json({error:'invalid credentials'})
  const s=await readStore(); if(s.users.some(u=>u.username.toLowerCase()===name.toLowerCase())) return res.status(409).json({error:'username exists'})
  const pw=makePassword(password)
  const user={id:code('USR'),username:name.slice(0,40),displayName:String(displayName||name).slice(0,60),telegram:String(telegram).slice(0,80),passwordSalt:pw.salt,passwordHash:pw.hash,createdAt:new Date().toISOString(),savedDestinations:[]}
  const token=crypto.randomBytes(32).toString('hex')
  s.users.push(user); s.sessions.push({token,userId:user.id,createdAt:new Date().toISOString()}); await writeStore(s)
  res.status(201).json({token,user:publicUser(user)})
})
app.post('/api/auth/login',async(req,res)=>{
  const {username,password}=req.body||{}; const s=await readStore(); const user=s.users.find(u=>u.username.toLowerCase()===String(username||'').trim().toLowerCase())
  if(!user||!verifyPassword(password||'',user)) return res.status(401).json({error:'invalid credentials'})
  const token=crypto.randomBytes(32).toString('hex'); s.sessions.push({token,userId:user.id,createdAt:new Date().toISOString()}); await writeStore(s)
  res.json({token,user:publicUser(user)})
})
app.get('/api/auth/me',requireUser,async(req,res)=>res.json({user:publicUser(req.user)}))
app.post('/api/auth/logout',async(req,res)=>{ const token=bearer(req); const s=await readStore(); s.sessions=s.sessions.filter(x=>x.token!==token); await writeStore(s); res.json({ok:true}) })
app.patch('/api/account/profile',requireUser,async(req,res)=>{
  const s=await readStore(); const user=s.users.find(u=>u.id===req.user.id); if(!user)return res.status(404).json({error:'user not found'})
  user.displayName=String(req.body?.displayName||user.displayName||user.username).slice(0,60)
  user.telegram=String(req.body?.telegram||'').slice(0,80)
  await writeStore(s); res.json({user:publicUser(user)})
})
app.get('/api/account/orders',requireUser,async(req,res)=>{ const s=await readStore(); res.json({orders:s.orders.filter(o=>o.userId===req.user.id).sort((a,b)=>+new Date(b.createdAt)-+new Date(a.createdAt))}) })

app.get('/api/products',async(_,res)=>{ const s=await readStore(); res.json(s.products) })
app.get('/api/products/:id',async(req,res)=>{const s=await readStore();const p=s.products.find(x=>x.id===req.params.id);if(!p)return res.status(404).json({error:'not found'});res.json(p)})
app.get('/api/reviews',async(req,res)=>{ const s=readStore(); res.json(s.reviews.filter(x=>x.approved!==false && (req.query.productId?x.productId===req.query.productId:!x.productId))) })
app.get('/api/about',async(_,res)=>{ const s=await readStore(); res.json(s.about) })
app.get('/api/hopamats',async(_,res)=>{ const s=await readStore(); res.json(s.hopamats.filter(x=>x.enabled!==false)) })
app.post('/api/reviews',async(req,res)=>{
  const {name,text,rating,productId}=req.body||{}; if(!name||!text||rating<1||rating>5) return res.status(400).json({error:'invalid review'})
  const s=await readStore(); if(productId && !s.products.some(p=>p.id===String(productId)))return res.status(404).json({error:'product not found'}); const review={id:code('REV'),productId:String(productId||''),name:String(name).slice(0,40),text:String(text).slice(0,1200),rating:Number(rating),createdAt:new Date().toISOString(),approved:true}; s.reviews.unshift(review); await writeStore(s)
  await notifyTelegram(`⭐ <b>Новий відгук XopaShop</b>\n${review.name} — ${review.rating}/5\n${review.text}`); res.status(201).json(review)
})
app.post('/api/orders',async(req,res)=>{
  const {customer,telegram,items,total,destination}=req.body||{}; if(!customer||!Array.isArray(items)||!items.length) return res.status(400).json({error:'invalid order'})
  if(!destination||!['territory','coords','hopamat'].includes(destination.type)||!destination.value) return res.status(400).json({error:'delivery destination required'})
  const user=await currentUser(req); const s=await readStore(); const now=new Date().toISOString()
  const normalizedItems=[]; let serverTotal=0
  for(const raw of items){ const product=s.products.find(p=>p.id===raw.id); if(!product) return res.status(400).json({error:`unknown product: ${raw.id}`}); const qty=Math.max(1,Math.min(99,Math.trunc(Number(raw.qty)||1))); if(qty>product.stock)return res.status(400).json({error:`insufficient stock: ${product.title}`}); normalizedItems.push({id:product.id,title:product.title,qty,price:product.price}); serverTotal += product.price*qty }
  const order={id:code('XOPA'),userId:user?.id||null,customer:String(customer).slice(0,80),telegram:String(telegram||'').slice(0,80),items:normalizedItems,total:serverTotal,delivery:25,status:'Прийнято',destination,createdAt:now,updatedAt:now,trackingEvents:[{id:code('EV'),status:'Замовлення прийнято',location:'XopaShop',note:'Замовлення зареєстровано в системі.',createdAt:now}]}
  s.orders.unshift(order); await writeStore(s)
  const lines=normalizedItems.map(i=>`• ${i.title} ×${i.qty}`).join('\n')
  await notifyTelegram(`🛒 <b>Нове замовлення ${order.id}</b>\nПокупець: ${order.customer}\nTG: ${order.telegram||'—'}\n${lines}\nДоставка: ${destination.type} — ${destination.value}\nРазом: ${order.total+25} діямантів`)
  res.status(201).json(order)
})
app.get('/api/orders/:id',async(req,res)=>{ const s=await readStore(); const order=s.orders.find(o=>o.id===req.params.id); if(!order) return res.status(404).json({error:'not found'}); res.json(order) })
app.post('/api/weekly-box',async(req,res)=>{ const {name,telegram}=req.body||{}; if(!name) return res.status(400).json({error:'name required'}); await notifyTelegram(`🎁 <b>Хоп'яна коробка тижня</b>\n${String(name).slice(0,80)} хоче взяти участь.\nTG: ${String(telegram||'—').slice(0,80)}`); res.json({ok:true}) })
app.post('/api/buyback',async(req,res)=>{ const {name,telegram,item,amount,price,comment}=req.body||{}; if(!name||!item) return res.status(400).json({error:'invalid request'}); await notifyTelegram(`💎 <b>Заявка на викуп</b>\nПродавець: ${name}\nTG: ${telegram||'—'}\nТовар: ${item}\nКількість: ${amount||'—'}\nБажана ціна: ${price||'—'}\n${comment?`Коментар: ${comment}`:''}`); res.json({ok:true}) })

// Admin API
app.get('/api/admin/snapshot',requireAdmin,async(_,res)=>{const s=await readStore();res.json({products:s.products,orders:s.orders,reviews:s.reviews,about:s.about,users:s.users.map(publicUser),hopamats:s.hopamats})})
app.post('/api/admin/products',requireAdmin,async(req,res)=>{const s=await readStore();const p=normalizeProduct(req.body);if(!p.title)return res.status(400).json({error:'title required'});s.products.unshift(p);await writeStore(s);res.status(201).json(p)})
app.put('/api/admin/products/:id',requireAdmin,async(req,res)=>{const s=await readStore();const idx=s.products.findIndex(x=>x.id===req.params.id);if(idx<0)return res.status(404).json({error:'not found'});s.products[idx]=normalizeProduct(req.body,s.products[idx]);await writeStore(s);res.json(s.products[idx])})
app.delete('/api/admin/products/:id',requireAdmin,async(req,res)=>{const s=await readStore();s.products=s.products.filter(x=>x.id!==req.params.id);await writeStore(s);res.json({ok:true})})
app.post('/api/admin/upload-image',requireAdmin,async(req,res)=>{
  const {name='image.png',data=''}=req.body||{}
  const m=String(data).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if(!m)return res.status(400).json({error:'invalid image'})
  const ext=(m[1].split('/')[1]||'png').replace(/[^a-z0-9]/gi,'').slice(0,5)
  const file=`${Date.now()}-${slugify(path.basename(String(name),path.extname(String(name))))}.${ext}`
  await fs.writeFile(path.join(uploadsDir,file),Buffer.from(m[2],'base64'))
  res.json({url:`${req.protocol}://${req.get('host')}/uploads/${file}`})
})
app.patch('/api/admin/orders/:id/tracking/:eventId',requireAdmin,async(req,res)=>{
  const s=readStore(),o=s.orders.find(x=>x.id===req.params.id)
  if(!o)return res.sendStatus(404)
  const ev=(o.trackingEvents||[]).find(x=>x.id===req.params.eventId)
  if(!ev)return res.sendStatus(404)
  for(const field of ['status','location','note'])if(typeof req.body?.[field]==='string')ev[field]=req.body[field].slice(0,500)
  o.status=o.trackingEvents.at(-1)?.status||'Прийнято';o.updatedAt=new Date().toISOString();writeStore(s);res.json(o)
})
app.delete('/api/admin/orders/:id/tracking/:eventId',requireAdmin,async(req,res)=>{
  const s=readStore(),o=s.orders.find(x=>x.id===req.params.id)
  if(!o)return res.sendStatus(404)
  if(o.trackingEvents?.[0]?.id===req.params.eventId)return res.status(400).json({error:'initial event cannot be removed'})
  o.trackingEvents=(o.trackingEvents||[]).filter(x=>x.id!==req.params.eventId)
  o.status=o.trackingEvents.at(-1)?.status||'Прийнято';o.updatedAt=new Date().toISOString();writeStore(s);res.json(o)
})
app.post('/api/admin/orders/:id/tracking',requireAdmin,async(req,res)=>{
  const s=await readStore(); const order=s.orders.find(o=>o.id===req.params.id); if(!order)return res.status(404).json({error:'not found'})
  const status=String(req.body?.status||order.status).slice(0,100); const location=String(req.body?.location||'').slice(0,180); const note=String(req.body?.note||'').slice(0,500); const now=new Date().toISOString()
  order.status=status; order.updatedAt=now; order.trackingEvents ||= []; order.trackingEvents.push({id:code('EV'),status,location,note,createdAt:now}); await writeStore(s)
  await notifyTelegram(`🚚 <b>${order.id}</b>\nНовий статус: ${status}${location?`\nМісце: ${location}`:''}`)
  res.json(order)
})
app.post('/api/admin/hopamats',requireAdmin,async(req,res)=>{const {name,territory,address,coords='',enabled=true,note=''}=req.body||{};if(!name||!territory||!address)return res.status(400).json({error:'fields required'});const s=await readStore();const h={id:code('HOP'),name:String(name).slice(0,100),territory:String(territory).slice(0,120),address:String(address).slice(0,200),coords:String(coords).slice(0,100),enabled:Boolean(enabled),note:String(note).slice(0,500)};s.hopamats.push(h);await writeStore(s);res.status(201).json(h)})
app.delete('/api/admin/hopamats/:id',requireAdmin,async(req,res)=>{const s=await readStore();s.hopamats=s.hopamats.filter(h=>h.id!==req.params.id);await writeStore(s);res.json({ok:true})})
app.patch('/api/admin/reviews/:id',requireAdmin,async(req,res)=>{const s=await readStore();const r=s.reviews.find(x=>x.id===req.params.id);if(!r)return res.status(404).json({error:'not found'});r.approved=Boolean(req.body?.approved);await writeStore(s);res.json(r)})
app.post('/api/admin/about',requireAdmin,async(req,res)=>{const {title,text,image=''}=req.body||{};if(!title||!text)return res.status(400).json({error:'title and text required'});const s=await readStore();const block={id:code('ABOUT'),title:String(title).slice(0,120),text:String(text).slice(0,4000),image:String(image).slice(0,2000)};s.about.push(block);await writeStore(s);res.status(201).json(block)})

// Telegram channel sync. Recommended post format:
// #product | Title | department | price | oldPrice | imageUrl | stock | game
async function botReply(chatId,text){
  if(!BOT_TOKEN) return
  const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,text})})
  if(!r.ok) console.error('Telegram API failed:',r.status)
}
app.post('/api/telegram/webhook',async(req,res)=>{
  if(!WEBHOOK_SECRET || req.header('x-telegram-bot-api-secret-token')!==WEBHOOK_SECRET) return res.sendStatus(403)
  const update=req.body||{}
  const post=update.channel_post||update.edited_channel_post
  const raw=post?.text||post?.caption||''
  if(post && (!CHANNEL_ID || String(post.chat?.id)!==CHANNEL_ID)) return res.json({ok:true,ignored:'channel not allowed'})
  if(post && raw.startsWith('#product')){
    const fields=raw.split('|').map(x=>x.trim())
    if(fields.length>=4 && fields[1] && Number.isFinite(Number(fields[3]))){
      const s=readStore();const id=`tg-${post.chat.id}-${post.message_id}`
      let image=fields[5]||''
      if(!image && post.photo?.length && BOT_TOKEN){
        // Telegram files need an authenticated download; store them locally, never expose bot token.
        const fileId=post.photo.at(-1).file_id
        const info=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`).then(x=>x.json())
        if(info.ok && info.result?.file_path){
          const name=`telegram-${post.chat.id}-${post.message_id}.jpg`
          const response=await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${info.result.file_path}`)
          if(response.ok){await fs.writeFile(path.join(uploadsDir,name),Buffer.from(await response.arrayBuffer()));image=`/uploads/${name}`}
        }
      }
      const product=normalizeProduct({id,title:fields[1],department:fields[2],price:Number(fields[3]),oldPrice:fields[4]?Number(fields[4]):undefined,image,stock:fields[6]?Number(fields[6]):99,game:fields[7]||'Minecraft',description:fields[8]||'Товар із Telegram-каналу XopaShop.',badge:'TG'})
      const index=s.products.findIndex(x=>x.id===id)
      if(index>=0)s.products[index]=normalizeProduct(product,s.products[index]);else s.products.unshift(product)
      writeStore(s)
    }
  }
  const msg=update.message
  if(msg?.text){
    const [command,arg]=msg.text.trim().split(/\s+/)
    const s=readStore()
    if(command==='/start'||command==='/help') await botReply(msg.chat.id,'XopaShop\n/help — команди\n/catalog — каталог\n/deals — акції\n/track КОД — статус замовлення\n/order КОД — інформація про замовлення')
    else if(command==='/catalog') await botReply(msg.chat.id,s.products.slice(0,12).map(p=>`${p.title} — ${p.price} діямантів`).join('\n')||'Каталог поки порожній')
    else if(command==='/deals') await botReply(msg.chat.id,s.products.filter(p=>p.oldPrice>p.price).slice(0,12).map(p=>`${p.title}: ${p.price} (було ${p.oldPrice})`).join('\n')||'Акцій зараз немає')
    else if(command==='/track'||command==='/order'){
      const o=s.orders.find(x=>x.id===arg)
      const e=o?.trackingEvents?.at(-1)
      await botReply(msg.chat.id,o?`Замовлення ${o.id}\nСтатус: ${o.status}\n${e?.location||''}\nОновлено: ${o.updatedAt}`:'Не знайдено. Вкажіть правильний код замовлення.')
    }
  }
  res.json({ok:true})
})

const dist=path.join(root,'dist')
try { await fs.access(dist); app.use(express.static(dist)); app.use((req,res,next)=>{ if(req.method==='GET'&&!req.path.startsWith('/api/')&&!req.path.startsWith('/uploads/')) return res.sendFile(path.join(dist,'index.html')); next() }) } catch {}
app.listen(PORT,()=>console.log(`XopaShop API: http://localhost:${PORT}`))
