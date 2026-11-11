// 只为本扩展自己发出的素材请求补上 Referer（抖音 CDN 有时会校验来源）。
// 规则限定 initiatorDomains = 本扩展 ID，不会影响你浏览的任何网页。
const CDN_DOMAINS = [
  "douyinpic.com",
  "douyinstatic.com",
  "douyinvod.com",
  "zjcdn.com",
  "amemv.com"
];

async function installRules() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1],
      addRules: [
        {
          id: 1,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              { header: "referer", operation: "set", value: "https://www.douyin.com/" }
            ]
          },
          condition: {
            requestDomains: CDN_DOMAINS,
            initiatorDomains: [chrome.runtime.id],
            resourceTypes: ["xmlhttprequest", "image", "media", "other"]
          }
        }
      ]
    });
  } catch (e) {
    console.warn("[douyin-note-to-video] DNR rule failed:", e);
  }
}

chrome.runtime.onInstalled.addListener(installRules);
chrome.runtime.onStartup.addListener(installRules);
