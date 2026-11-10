# 拾影 Android 安装包

应用名称：拾影。包名：`cn.shiying.studio`。版本：`1.0.2`（versionCode 3）。支持 Android 8.0 及以上，建议使用最新 Android System WebView。支持一键清空、ZIP 和不打包的逐个下载。

安装包下载：`https://shiying-api.castle9611-shiying.workers.dev/downloads/shiying.apk`。对应文件在 `web/downloads/shiying.apk`，仅作为网站下载资产发布，不会递归打包进下一份 APK。

## 包含内容

APK 内置 `web/` 的 HTML、CSS、JavaScript，使用 Android WebView 展示。不包含 PHP、Node、Cloudflare Worker、数据库或任何后台服务。解析、注册登录与媒体获取均请求现有 Cloudflare HTTPS 后端：

`https://shiying-api.castle9611-shiying.workers.dev`

云端网站已有账号可以直接登录。APK 中登录状态保存在应用私有 WebView 存储中，仍由后端校验 24 小时会话有效期。登录失败或过期时需要重新登录。主页批量功能继续隐藏。

## 下载

单项和 ZIP 下载使用系统文件保存窗口选择位置；逐个下载多个文件时，选择一次文件夹后依次保存，不打包 ZIP、不逐个弹出保存窗口。网页通过分块传输将 Blob 写入 Android 选定文件，不把整个文件编码到一个巨大字符串，不申请相册、全部文件访问或外部存储权限。网络、解析和下载限制与网页相同；小红书云端登录限制也保持一致。

## 构建

GitHub Actions → **Build Android APK** → Run workflow。签名后的安装包在构建产物 **Shiying-Android-1.0.2** 中。构建运行签名验证，并提供 SHA256 校验值。

本地有 JDK 17、Android SDK 35、Build Tools 35.0.0 和 Gradle 8.11.1 时，可执行：

```sh
gradle -p android assembleRelease
```

需通过环境变量提供 `ANDROID_KEYSTORE_PATH` 与 `ANDROID_KEYSTORE_PASSWORD`。不把签名密钥或密码写入源码。

当前签名文件和密码保存在本地忽略目录 `.runtime/android-signing/`，GitHub 构建只使用仓库加密 Secrets。请妥善备份该目录，用于后续同包名覆盖升级；修改版本时增加 `versionCode`。不要提交或公开该目录。

前端有修改时重新构建 APK，即会打包最新网页文件。后端修改通过 Cloudflare 部署独立生效。

## 验证范围

构建应检查 Android 编译、APK 签名、包名/版本及前端资源完整性。JavaScript 测试检查分块保存、取消及错误处理。没有连接真机时，扫码以外的登录、视频播放、系统保存位置选择及触控效果仍需在安装后验证。
