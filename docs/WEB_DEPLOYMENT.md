# 拾影 Web UI：本地与 Cloudflare

当前网页支持抖音、快手、小红书的单条公开作品解析，包含视频、图集、实况、原图预览、单项下载与勾选 ZIP 打包。使用前必须注册登录。主页批量功能暂缓，默认隐藏且接口关闭。

**线上验证（2026-11-11）：** Cloudflare 的小红书解析已加入 Browser Run 浏览器回退，提供的公开图集短链已解析出 8 张图片并通过实际下载验证。普通 HTTP 解析失败后才启动匿名浏览器，不需要用户提供 Cookie；不保证登录可见、私密、删除或被平台验证拦截的作品可用。Browser Run 受账号额度限制（Workers Free 当前为每天 10 分钟），额度耗尽时需等待恢复；不会自动升级付费套餐。现有 APK 调用同一云端接口，无需因后端修复而重装。抖音视频“她不一样”使用的新媒体域名已加入精确白名单，实际 MP4 下载通过；白名单同时用于本地与云端。

## 本地运行

当前 Windows 工作区已安装独立 PHP（`.runtime/php`），启动：

```powershell
./start.ps1
```

默认监听 `0.0.0.0:8080`，控制台打印本机和局域网访问地址。当前设备地址为 `http://192.168.21.101:8080`，网络分配的 IP 变化后以启动输出为准。仅本机访问可使用 `./start.ps1 -ListenAddress 127.0.0.1`。

局域网防火墙配置以管理员身份运行 `scripts/enable-lan.ps1`；规则仅允许专用网络中 LocalSubnet 访问该 PHP 程序的 TCP 8080 端口。新端口使用 `-Port` 参数。

其他环境需 PHP 8.1+，启用 curl、openssl、pdo_sqlite、mbstring：

```sh
php -S 127.0.0.1:8080 server/router.php
```

必须使用 router，仅公开 `web/` 资产；不要将整个仓库直接公开为静态目录。账号数据保存在 `var/app.sqlite`。运行时、账号、浏览器会话、环境秘密均不提交到 GitHub。本地账号与 Cloudflare 账号数据库独立。

## Cloudflare 运行方式

前端静态资产与 API 一并部署到同一个 Worker，通过一个 HTTPS 域名访问。D1 保存账号、令牌摘要和短期下载句柄。不依赖本机 PHP 服务或 GitHub Pages。三个平台均有原生 JavaScript 解析代码；原仓库 PHP 解析器保留供本地使用。

```sh
npm ci
npm run db:local
npm run dev
```

访问 `http://127.0.0.1:8787`，即使用与云端相同的前后端代码。首次部署到新的 Cloudflare 账号需创建 D1 数据库，并把数据库 ID 填入 `wrangler.jsonc`；本项目现有数据库 ID 已配置。

```sh
npx wrangler login --scopes account:read user:read workers:write workers_scripts:write workers_routes:write d1:write
npx wrangler d1 execute shiying-users --remote --file cloudflare/schema.sql
npm run deploy
```

schema 使用 `CREATE TABLE IF NOT EXISTS`，保留现有用户数据。当前域名：`https://shiying-api.castle9611-shiying.workers.dev`。前后端同域，`web/config.js` 无需写死 API 域名。`ALLOWED_ORIGINS` 用于额外允许的开发来源。

## 下载与账号

每次解析生成一小时有效、绑定当前账号的下载句柄。下载接口不接受任意 URL，每次跳转都检查媒体域名；PHP 额外验证公网地址并固定 DNS。下载需有效登录，退出后令牌失效。

单文件上限 100 MB；每次 ZIP 最多 100 个文件、合计 150 MB。浏览器按顺序下载后生成 ZIP；部分失败会在 ZIP 中附带失败清单，页面明确显示成功和失败数量。文件在浏览器端暂存，不会长期存入 Cloudflare。

云端密码使用随机盐与 PBKDF2-SHA256；本地 PHP 使用 password_hash。随机会话令牌仅保存 SHA-256 摘要，有效期 24 小时。邮箱作为账号标识，目前不提供邮箱验证或密码找回。

移动端支持双列图集、全宽视频、站内原图切换与滑动预览、安全区及触控按钮。后续封装 APK 时，应为 Android WebView 接入 Blob 下载处理或原生下载桥；网页 ZIP 下载行为需要在实际 APK 中单独验收。

## 验证与同步

```sh
npm run test:php
npm run test:worker
npm run test:frontend
npm run test:platforms
npm run test:zip
npm run test:login
npm run build
```

PHP/Worker HTTP 测试使用临时数据库，检查账号、登录撤销与过期、跨域、非法输入、私有文件隔离、下载权限和限流。设置 `TEST_SHARE_URL` 可同时验证真实解析和实际媒体下载。真实平台响应受网络、作品公开状态、短链有效期和平台策略影响；保留小红书分享链接中的签名参数。

`.github/workflows/checks.yml` 在推送时运行验证，不发布网页。GitHub Pages 发布流程已移除；生产部署只通过 Cloudflare。

## 暂缓的主页功能

主页和本机抖音登录助手代码为后续功能保留，默认关闭。仅开发调试可通过 `./start.ps1 -EnableHomeLogin` 启用。用户在独立 Edge 窗口中自行完成抖音登录；助手不读取已有浏览器个人资料、不自动输入账号密码，不把 Cookie 返回网页。Cloudflare 尚未接入此登录窗口，不能将其视为已交付的云端能力。
