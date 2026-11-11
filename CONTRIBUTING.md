# 贡献指南

感谢你愿意参与！

## 回报问题

如果某个作品读取失败或合成出错，请在 Issue 中附上：

- 作品链接（`douyin.com/note/…`）
- 弹窗或工作台显示的错误信息
- 工作台下方「ffmpeg 日志」的内容（合成失败时）
- Chrome 版本与操作系统

**请不要贴整个网页源代码**，里面包含你的登录信息（用户 ID、设备标识等）。

## 提交代码

1. Fork 本仓库并新建分支：`git checkout -b fix/xxx`
2. 修改代码。数据解析和合成参数都在 `extension/lib/parse.js`，修改时请在 `test/` 补上对应测试
3. 确认测试通过：`npm test`
4. 在 `chrome://extensions` 重新加载插件，手动验证：
   - 直接打开的作品页（`/note/…`）
   - 从推荐流点开的作品（`?modal_id=…`）
   - 合成视频，以及「下载原图和音乐」
5. 更新 `CHANGELOG.md` 的「未发布」区块
6. 提交 PR，说明改了什么、为什么

抖音改版导致读取失败时，通常只需要修改 `parse.js` 里的 `findAwemeInFlight` / `normalizeAweme`。测试数据请自行脱敏（去掉账号、设备、签名等信息），参考 `test/fixtures/`。

## 原则

- 不引入任何会把数据发送到第三方的功能或库
- 不新增非必要的权限
- 除了 ffmpeg.wasm，保持零依赖、无需构建即可加载
- 不得移除或绕过 DRM，不支持下载用户无权查看的内容

## 升级 ffmpeg.wasm

1. 修改 `package.json` 里 `@ffmpeg/ffmpeg`、`@ffmpeg/core` 的版本
2. `npm install && npm run vendor`
3. 重新加载插件，完整合成一次确认可用

## 发布新版本（维护者）

1. 修改 `extension/manifest.json` 与 `package.json` 的 `version`
2. 更新 `CHANGELOG.md`
3. `npm run build`，把 `dist/` 里的 zip 上传到 Chrome Web Store 开发者后台
4. 打 tag：`git tag v1.x.x && git push --tags`
