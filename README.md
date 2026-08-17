# citv-live-analytics-sdk

> [!IMPORTANT]
> SSR 环境会静默跳过，仅在浏览器客户端执行数据采集与上报。SDK 不依赖 React、Vue
> 等前端框架。

轻量级直播间页面访问数据采集 SDK。页面每次加载时调用一次 `init`，SDK 会立即
记录一次页面访问，并在随机延迟后向 CITV Analytics API 上报；每次成功上报计为
一次 PV，服务端根据持久化的 `visitor_id` 去重计算 UV。

```ts
import { analytics } from "@citv-cn/citv-live-analytics-sdk"

analytics.init({
  appid: "app-1",
  ccid: "room-001",
})
```

SDK 会向以下固定地址发送请求：

```text
POST https://checker.citv.cn/api/v2/analytics/page-views
```

请求体符合 CITV Frontend Analytics OpenAPI：

```json
{
  "appid": "app-1",
  "ccid": "room-001",
  "visitor_id": "de840a34-fad8-410c-af35-aec2078d10fa",
  "event_id": "3f242e95-cbd7-44c8-b73b-7912db97300f",
  "occurred_at": "2026-08-14T07:30:00.000Z",
  "page_url": "https://checker.citv.cn/live/room-001"
}
```

`visitor_id` 首次生成后保存在 `localStorage`，刷新页面时保持不变；每次调用
`init` 都会生成新的 `event_id`。事件会在 3–5 分钟的随机延迟后使用 `fetch` 和
`keepalive` 顺序发送，以平滑服务端瞬时流量；页面隐藏时使用
`navigator.sendBeacon` 提前发送待上报事件，发送失败时自动回退到 `fetch`。
