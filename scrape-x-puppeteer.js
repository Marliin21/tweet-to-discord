// scrape-x-puppeteer.js
// Benutzung: Puppeteer lädt mobile.twitter.com/USERNAME und extrahiert Tweets.
// ENV: TWITTER_USER, DISCORD_WEBHOOK
// Speichert last_id.txt wie Variante A.

const fs = require('fs');
const puppeteer = require('puppeteer');

const USER = process.env.TWITTER_USER;
const WEBHOOK = process.env.DISCORD_WEBHOOK;
if(!USER || !WEBHOOK){
  console.error('ERROR: Set TWITTER_USER and DISCORD_WEBHOOK as env vars.');
  process.exit(1);
}

const LAST_FILE = './last_id.txt';
const BASE = 'https://mobile.twitter.com';

function readLast(){
  if(fs.existsSync(LAST_FILE)) return fs.readFileSync(LAST_FILE,'utf8').trim() || null;
  return null;
}
function writeLast(id){
  fs.writeFileSync(LAST_FILE, id || '');
}

async function sendDiscord(msg){
  const r = await require('node-fetch')(WEBHOOK, {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ content: msg })
  });
  if(!r.ok){
    const t = await r.text().catch(()=>'<no body>');
    console.error('Discord error', r.status, t);
  }
}

(async ()=>{
  const browser = await puppeteer.launch({
    args: ['--no-sandbox','--disable-setuid-sandbox'],
    headless: true
  });

  try{
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const url = `${BASE}/${USER}`;
    console.log('Loading', url);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });

    // Evaluate tweets
    const tweets = await page.evaluate(() => {
      const out = [];
      // Prefer article[data-testid="tweet"]
      const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
      if(articles.length){
        for(const a of articles){
          const linkEl = a.querySelector('a[href*="/status/"]');
          const href = linkEl ? linkEl.getAttribute('href') : null;
          const url = href ? (location.origin + href) : null;
          const idMatch = href ? href.match(/status\/(\d+)/) : null;
          const id = idMatch ? idMatch[1] : url || Math.random().toString(36);
          const textEl = a.querySelector('div[lang]');
          const text = textEl ? textEl.innerText.trim() : a.innerText.trim();
          const timeEl = a.querySelector('time') ? a.querySelector('time').getAttribute('datetime') : '';
          out.push({ id, url, text, time: timeEl });
        }
      } else {
        // fallback: search for links containing /status/
        const links = Array.from(document.querySelectorAll('a[href*="/status/"]')).slice(0,30);
        for(const l of links){
          const href = l.getAttribute('href');
          const idMatch = href.match(/status\/(\d+)/);
          const id = idMatch ? idMatch[1] : href;
          // climb up to find a container for text
          let container = l.closest('div');
          let text = '';
          if(container){
            const tEl = container.querySelector('div[lang]') || container;
            text = tEl ? tEl.innerText.trim() : '';
          }
          const url = href.startsWith('http') ? href : (location.origin + href);
          out.push({ id, url, text, time: '' });
        }
      }
      return out;
    });

    if(!tweets || tweets.length === 0){
      console.log('Keine Tweets extrahiert (Seite evtl. Leerseite oder Login required).');
      await browser.close();
      return;
    }

    // find last processed id
    const last = readLast();
    if(!last){
      writeLast(tweets[0].id);
      console.log('Initialisiere last_id mit', tweets[0].id, '- keine Sends beim ersten Lauf.');
      await browser.close();
      return;
    }

    // find index of last
    const idxLast = tweets.findIndex(t => t.id === last);
    let newItems = [];
    if(idxLast === -1){
      // last not found - only send newest to avoid spam
      newItems = [tweets[0]];
    } else if(idxLast > 0){
      newItems = tweets.slice(0, idxLast).reverse(); // oldest -> newest
    } else {
      newItems = [];
    }

    for(const it of newItems){
      const text = (it.text || '').trim();
      const link = it.url || (BASE + '/' + USER);
      const msg = text ? `${text}\n${link}` : link;
      await sendDiscord(msg);
      console.log('Sent', it.id);
      writeLast(it.id);
      await new Promise(r=>setTimeout(r,400));
    }

    if(newItems.length === 0) console.log('Keine neuen Tweets.');
    await browser.close();
  }catch(err){
    console.error('Fehler:', err && err.message ? err.message : err);
    try{ await browser.close(); }catch(e){}
    process.exit(1);
  }
})();
