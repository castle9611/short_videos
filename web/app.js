const $ = id => document.getElementById(id);
const configured = window.APP_CONFIG?.apiBase?.replace(/\/$/, '') || '';
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
const base = configured || (local ? location.origin : '');
let token = sessionStorage.getItem('shiying-token') || '';
let registering = false;
let busy = false;
async function api(path, body) {
  if (!base) throw new Error('站点尚未连接后端，请由部署者配置 API 地址。');
  const response = await fetch(base + '/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(65000)
  });
  const result = await response.json().catch(() => { throw new Error('服务暂时不可用，请稍后再试。'); });
  if (response.status === 401 && !['login', 'register'].includes(path)) { clearSession(); showAuth(); }
  if (!response.ok) throw new Error(result.msg || '请求失败');
  return result;
}
function clearSession() { token = ''; sessionStorage.removeItem('shiying-token'); renderAccount(); $('result').hidden = true; $('result').replaceChildren(); }
function renderAccount(email) {
  $('account').replaceChildren();
  if (email) { const name = document.createElement('span'); name.textContent = email; $('account').append(name); }
  const button = document.createElement('button'); button.className = 'text-button'; button.textContent = token ? '退出登录 ↗' : '登录 / 注册 ↗';
  button.onclick = async () => { if (!token) return showAuth(); try { await api('logout', {}); clearSession(); } catch (e) { $('status').textContent = e.message; } };
  $('account').append(button);
}
function showAuth() { if (!$('auth-dialog').open) $('auth-dialog').showModal(); }
$('close-auth').onclick = () => $('auth-dialog').close();
$('switch-auth').onclick = () => { registering = !registering; $('auth-title').textContent = registering ? '创建你的账号' : '登录拾影'; $('auth-submit').textContent = registering ? '注册并登录 ↗' : '登录 ↗'; $('password').autocomplete = registering ? 'new-password' : 'current-password'; $('switch-auth').textContent = registering ? '已有账号？返回登录' : '还没有账号？立即注册'; $('auth-error').textContent = ''; };
$('auth-form').onsubmit = async event => {
  event.preventDefault(); $('auth-submit').disabled = true; $('auth-error').textContent = '';
  try { const data = await api(registering ? 'register' : 'login', { email: $('email').value, password: $('password').value }); token = data.token; sessionStorage.setItem('shiying-token', token); renderAccount(data.email); $('password').value = ''; $('auth-dialog').close(); $('status').textContent = '登录成功，可以开始解析了。'; }
  catch (e) { $('auth-error').textContent = e.message; }
  finally { $('auth-submit').disabled = false; }
};
function safeUrl(value) { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : null; } catch { return null; } }
function mediaLink(value, text) { const href = safeUrl(value); if (!href) return; const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = text; $('result').append(a); }
function image(value) { const src = safeUrl(value); if (!src) return; const img = document.createElement('img'); img.src = src; img.alt = '解析出的图片'; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; $('result').append(img); }
function renderResult(result) {
  const d = result.data; if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('接口未返回有效媒体数据');
  $('result').replaceChildren(); const title = document.createElement('h2'); title.textContent = d.title || d.desc || '解析结果'; $('result').append(title);
  const meta = document.createElement('p'); meta.textContent = [d.author?.name, d.quality, d.duration ? d.duration + ' 秒' : '', d.size_label].filter(Boolean).join(' · '); $('result').append(meta);
  if (safeUrl(d.url)) { const video = document.createElement('video'); video.controls = true; video.preload = 'none'; video.src = safeUrl(d.url); if (safeUrl(d.cover)) video.poster = safeUrl(d.cover); $('result').append(video); mediaLink(d.url, '打开视频 / 保存 ↗'); }
  (Array.isArray(d.images) ? d.images : []).forEach((url, i) => { image(url); mediaLink(url, '原图 ' + (i + 1) + ' ↗'); });
  (Array.isArray(d.live_photo) ? d.live_photo : []).forEach((item, i) => { image(item.image || item.image_url); mediaLink(item.video || item.video_url, 'Live Photo ' + (i + 1) + ' ↗'); });
  mediaLink(d.music?.url, '背景音乐 ↗'); if (!d.url && !d.images?.length && safeUrl(d.cover)) image(d.cover);
  const note = document.createElement('p'); note.textContent = '若预览受到原平台防盗链限制，请打开媒体链接；在浏览器菜单中保存。媒体直链可能过期。'; $('result').append(note);
  const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = '查看完整解析数据'; const pre = document.createElement('pre'); pre.textContent = JSON.stringify(result, null, 2); details.append(summary, pre); $('result').append(details); $('result').hidden = false;
}
$('parse-form').onsubmit = async event => {
  event.preventDefault(); if (!token) return showAuth(); if (busy) return; busy = true; $('parse-button').disabled = true; $('parse-button').textContent = '正在解析…'; $('status').textContent = '正在提取媒体信息，请稍候…'; $('result').hidden = true;
  try { const result = await api('parse', { url: $('share').value }); if (Number(result.code) !== 200) throw new Error(result.msg || '解析失败，请检查链接是否公开可访问。'); renderResult(result); $('status').textContent = '解析完成。'; }
  catch (e) { $('status').textContent = e.name === 'TimeoutError' ? '解析超时，请稍后重试。' : e.message; }
  finally { busy = false; $('parse-button').disabled = false; $('parse-button').textContent = '解析链接 ↗'; }
};
renderAccount();
if (!base) $('connection').textContent = '等待配置后端服务，当前无法注册或解析。';
else api('health').then(d => { $('connection').textContent = d.parser ? (Array.isArray(d.platforms) ? '服务已连接 · 云端当前支持抖音；其他平台需连接 PHP 后端' : '服务已连接 · 注册登录后即可解析') : '服务已连接，解析运行环境尚未就绪'; if(Array.isArray(d.platforms)) document.querySelectorAll('.platform-grid>div').forEach((el,i)=>{if(i>0){el.style.opacity='.4';el.title='需连接 PHP 解析后端';}}); }).catch(() => { $('connection').textContent = '后端暂时无法连接，请检查服务状态。'; });
if (token) api('me').then(d => renderAccount(d.email)).catch(() => clearSession());
