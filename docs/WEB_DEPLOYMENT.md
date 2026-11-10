# 拾影 Web UI 部署

新增中文响应式界面、邮箱注册/登录和服务端解析权限。未登录请求会返回 401，退出后令牌立即失效。前端源代码在 `web/`，不会发布 PHP 源码或账号数据库。

## 本地完整 PHP 版本

Windows 当前工作区已经安装了独立 PHP 运行时（忽略的 `.runtime/php`）。运行：

```powershell
./start.ps1
```

访问 http://127.0.0.1:8080 。其他环境安装 PHP 8.0+，启用 curl、openssl、pdo_sqlite、mbstring 后：

```sh
php -S 127.0.0.1:8080 server/router.php
```

必须使用该 router，不能直接将仓库根目录公开为站点。生产环境应通过 Nginx/Apache 反向代理至此入口（或相同的前置控制器配置），并使用 HTTPS。PHP 内置服务器适用于本地开发。账号存储在 `var/app.sqlite`，备份时保留该文件；不要提交到 Git。

该入口调用仓库内原始 PHP 解析器，支持抖音、快手、小红书、B站、微博、头条、皮皮虾、皮皮搞笑、最右。解析成功率仍取决于平台公开接口、网络、作品是否可访问和部分平台的 Cookie 要求。网易云 Python 接口和抖音主页批量解析未接入网页。

## GitHub Pages 前端

`.github/workflows/pages.yml` 只上传 `web/`。仓库 Settings → Pages → Source 选择 GitHub Actions。修改 `web/config.js` 中 `apiBase` 为云端 HTTPS 后端地址。项目子目录下的资源全部使用相对地址。

## Cloudflare Workers + D1

Cloudflare Workers 不运行原仓库的 PHP。云端原生实现接入原仓库的抖音 Workers 解析器，支持抖音视频、图集和 Live Photo。网页会说明云端平台范围；其他平台返回明确的 501 提示，不会伪造解析结果。

```sh
npm install --no-save wrangler@4.160.0
npx wrangler login --scopes account:read user:read workers:write workers_scripts:write workers_routes:write d1:write
npx wrangler d1 create shiying-users
# 将返回的 database_id 填入 wrangler.jsonc
npx wrangler d1 execute shiying-users --remote --file cloudflare/schema.sql
npx wrangler deploy
```

`ALLOWED_ORIGINS` 是逗号分隔的前端来源列表，含协议、不含路径。默认允许 `https://castle9611.github.io` 和本地 8080 端口。

云端用户密码使用随机盐与 PBKDF2-SHA256（100000 次迭代），令牌随机生成、数据库仅保存 SHA-256 摘要，24 小时有效；注册/登录和解析均限流。邮箱目前作为账号标识，不发送邮件验证或密码重置邮件。

## 可选：云端接入其他平台

另有可持续运行 PHP 的 HTTPS 服务器时，部署 `server/router.php` 和原始 `api/`，在两端设置相同的随机 `PHP_BRIDGE_SECRET`；Cloudflare 通过 `wrangler secret put PHP_BRIDGE_SECRET` 保存秘密。设置 Worker 的 `PHP_BACKEND` 为该服务器 HTTPS origin。Worker 验证用户后通过 `/api/bridge` 请求 PHP，用户登录令牌不会转发给 PHP。不要把桥接密钥写进前端或 GitHub。

## 验证

```sh
python tests/smoke.py
# 设置 TEST_BASE_URL 可测试另一个后端，默认 http://127.0.0.1:8080
```

测试验证注册、重复注册、错误密码、登录权限、退出撤销、平台域名过滤、私有文件隔离。会创建随机 `qa-* @example.com` 测试账号。真实解析需使用有效的公开分享链接单独验证。
