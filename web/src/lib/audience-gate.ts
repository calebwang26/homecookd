// ROUTE_GATE: the lander's routing, as an inline <head> script (the first one, src/app/layout.tsx).
// Server-only on purpose: the string is injected into the HTML, so no client bundle should import
// this file (it would ship ~3 KB of dead text on the first screen). The routing table, the events
// and the client half (switchHref, logLand, logTap) live in src/lib/audience-route.ts.
//
// Runs on /, /learn and /teach only, before paint. Self-contained ES5 in a try/catch: it runs before
// any bundle, and a failure must leave the page as it is.
//  1. Reads aud (kid|parent), from (app|invite|r) and via (hero|footer) from the URL, then strips
//     them from the address bar with replaceState (utm_*, for, lite, log and the hash stay). If the
//     pick can't be saved (storage blocked, or a Back visit), aud stays in the address bar so a
//     reload keeps it (and a kid redirect then carries the whole query, so /learn re-reads it).
//  2. Saves an aud param as the visitor's pick (localStorage homecookd.aud), except on Back/Forward.
//  3. On / only: aud param > saved pick > Snapchat > parent default. A kid goes to /learn
//     (location.replace; <html> hidden until the browser leaves, 4s fallback), and the decision is
//     handed over in sessionStorage (homecookd.route, tied to /learn, valid 15s).
//  4. Remembers the tab's first arrival (signal + utm, sessionStorage homecookd.arrival), so a
//     later switch event can still say where the visitor came from.
//  5. Leaves window.__hcRoute = { signal, app, ui, back, arrival } for the logger.
// Back/Forward visits are never routed, saved or logged.
const AUD_KEY = 'homecookd.aud';
const ROUTE_KEY = 'homecookd.route';
const ARRIVAL_KEY = 'homecookd.arrival';

export const ROUTE_GATE = String.raw`(function(){var d=document.documentElement,L=location,w=window;try{
var K='${AUD_KEY}',RK='${ROUTE_KEY}',AK='${ARRIVAL_KEY}',ua=navigator.userAgent||'',p=L.pathname.replace(/\/+$/,'')||'/';
if(p!=='/'&&p!=='/learn'&&p!=='/teach')return;
var parts=L.search?L.search.slice(1).split('&'):[],keep=[],hit=false,a=null,f=null,v=null,us=null,uc=null,i,kv,k,x;
for(i=0;i<parts.length;i++){if(!parts[i])continue;kv=parts[i].split('=');k=kv[0];
try{x=decodeURIComponent(kv.slice(1).join('=').replace(/\+/g,' '))}catch(e){x=''}
if(k==='aud'){a=x;hit=true}else if(k==='from'){f=x;hit=true}else if(k==='via'){v=x;hit=true}else{keep.push(parts[i]);if(k==='utm_source')us=x.slice(0,100);else if(k==='utm_campaign')uc=x.slice(0,100)}}
if(a!=='kid'&&a!=='parent')a=null;if(f!=='app'&&f!=='invite'&&f!=='r')f=null;if(v!=='hero'&&v!=='footer')v=null;
var back=false;try{var n=performance.getEntriesByType&&performance.getEntriesByType('navigation')[0];
back=n?n.type==='back_forward':!!(performance.navigation&&performance.navigation.type===2)}catch(e){}
var app=/Snapchat/i.test(ua)?'snapchat':/Instagram/i.test(ua)?'instagram':/FBAN|FBAV|FB_IAB|FBIOS/.test(ua)?(/Messenger/i.test(ua)?'messenger':'facebook'):/musical_ly|BytedanceWebview|TikTok/i.test(ua)?'tiktok':/LinkedInApp/i.test(ua)?'linkedin':/Twitter/i.test(ua)?'twitter':/MicroMessenger/i.test(ua)?'wechat':/Pinterest/i.test(ua)?'pinterest':/Reddit/i.test(ua)?'reddit':/ Line\//.test(ua)?'line':null;
var s=null;try{s=localStorage.getItem(K)}catch(e){}if(s!=='kid'&&s!=='parent')s=null;
var kept=false;if(a){if(back)kept=true;else{try{localStorage.setItem(K,a)}catch(e){kept=true}}if(kept)keep.push('aud='+a)}
var sig=v?'switch':f?'link':a?'aud':null,ui=v,h=null;
try{h=sessionStorage.getItem(RK);if(h){sessionStorage.removeItem(RK);h=JSON.parse(h);if(!h||h.p!==p||Date.now()-h.t>15000)h=null}}catch(e){h=null}
if(h&&!sig){sig=h.signal||null;ui=h.ui||null}
var qs=keep.length?'?'+keep.join('&'):'';
if(p==='/'&&!back){var aud=a||s||(app==='snapchat'?'kid':'parent');
if(!sig)sig=s?'saved':app==='snapchat'?'snapchat':'default';
if(aud==='kid'){var ok=false;try{sessionStorage.setItem(RK,JSON.stringify({signal:sig,ui:ui,p:'/learn',t:Date.now()}));ok=true}catch(e){}
w.__hcAway=true;d.style.visibility='hidden';setTimeout(function(){d.style.visibility=''},4000);
L.replace('/learn'+(ok&&!kept?qs:L.search)+L.hash);return}}
if(hit){try{history.replaceState(history.state,'',L.pathname+qs+L.hash)}catch(e){}}
var arr=null;if(!back){try{arr=JSON.parse(sessionStorage.getItem(AK)||'null')}catch(e){arr=null}
if(!arr&&sig!=='switch'){arr={signal:sig,us:us,uc:uc};try{sessionStorage.setItem(AK,JSON.stringify(arr))}catch(e){}}}
w.__hcRoute={signal:back?null:sig,app:app,ui:back?null:ui,back:back,
arrival:!back&&sig==='switch'&&arr?{signal:arr.signal||null,utm_source:arr.us||null,utm_campaign:arr.uc||null}:null};
}catch(e){}})();`;
