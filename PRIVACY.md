# 隐私政策 / Privacy Policy

最后更新：2026-11-11

## 中文

「抖音图文转视频」（以下简称本插件）重视你的隐私。

**本插件不收集、不存储、不传输任何个人数据。**

- **页面数据**：仅在你点击插件图标时，读取当前抖音作品页中该作品的图片地址、音乐地址、作者昵称和文案，用于显示和合成。不会读取你的账号、Cookie 或其他页面内容。
- **接口数据缓存**：为支持在推荐流中点开的作品，插件会在抖音页面内缓存接口返回的图文作品数据（最多 200 条，只存在于该页面的内存中，关闭页面即清除）。插件不会修改任何请求或响应。
- **网络请求**：插件只向抖音自身的域名（`douyin.com` 及其图片、音乐 CDN）请求作品素材，并只为这些请求补上 `Referer: https://www.douyin.com/`。不会连接任何其他服务器。
- **本地处理**：视频合成使用随插件打包的 ffmpeg.wasm，完全在你的浏览器内完成，文件不会上传。
- **本地存储**：作品数据通过 `chrome.storage.session` 在弹窗和工作台之间临时传递，关闭浏览器即清空。
- **第三方**：本插件不包含任何统计、广告或第三方 SDK。

如有疑问，请在 GitHub 仓库提交 Issue。

## English

This extension **does not collect, store, or transmit any personal data.**

- **Page data**: only when you click the toolbar icon, the extension reads the current post's image URLs, music URL, author nickname and caption, to display and compose them. It does not read your account, cookies, or other page content.
- **API cache**: to support posts opened from the feed, the extension keeps API responses that contain image posts in the Douyin tab's memory (up to 200 items, cleared when the tab closes). Requests and responses are never modified.
- **Network**: the extension only fetches media from Douyin's own domains (`douyin.com` and its image/music CDNs), and only adds `Referer: https://www.douyin.com/` to its own requests. It contacts no other server.
- **Local processing**: the video is composed by the bundled ffmpeg.wasm inside your browser. No file is uploaded.
- **Storage**: post data is passed from the popup to the studio page through `chrome.storage.session`, which is cleared when the browser closes.
- **Third parties**: no analytics, ads, or third-party SDKs.

Questions? Please open an issue on the GitHub repository.
