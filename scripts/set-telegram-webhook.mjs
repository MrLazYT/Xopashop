try { process.loadEnvFile?.('.env') } catch {}
const token=process.env.TELEGRAM_BOT_TOKEN
const base=process.env.PUBLIC_SITE_URL
const secret=process.env.TELEGRAM_WEBHOOK_SECRET
if(!token||!base||!secret||!/^https:\/\//.test(base))throw new Error('Set TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, HTTPS PUBLIC_SITE_URL')
const url=`${base.replace(/\/$/,'')}/api/telegram/webhook`
const response=await fetch(`https://api.telegram.org/bot${token}/setWebhook`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url,secret_token:secret,allowed_updates:['message','channel_post','edited_channel_post']})})
const result=await response.json()
if(!result.ok){console.error(result);process.exitCode=1}else console.log('Telegram webhook set:',url)
