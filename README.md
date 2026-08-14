# citv-live-analytics-sdk

轻量级直播间访问数据采集 SDK。每次调用 `track` 计为一次 PV；同一浏览器的
`anonymous_id` 重复访问同一 `ccid` 时继续增加 PV，但不再增加 UV。

```js
import { analytics } from "@citv-cn/citv-live-analytics-sdk";

analytics.track({
  ccid: "ccid_10001",
});
```

`track` 会同步返回本次生成的事件：

```js
{
  event: "live_room_view",
  event_id: "evt_...",
  ccid: "ccid_10001",
  anonymous_id: "anon_...",
  pv: 1,
  uv: 1, // 同一 anonymous_id 再次访问该 ccid 时为 0
  timestamp: 1786665600000
}
```

刷新页面后 `anonymous_id` 和直播间首访标记仍保存在 `localStorage` 中。因此，
页面每次进入时调用一次 `track` 即可满足 PV/UV 统计语义。

后端接口确定后可配置上报地址：

```js
analytics.init({ endpoint: "https://example.com/analytics/events" });
analytics.track({ ccid: "ccid_10001" });
```

正常访问使用 `fetch` 发送 JSON；页面进入隐藏状态时，待发送事件会通过
`navigator.sendBeacon` 尽力送达。未配置 `endpoint` 时不会发起网络请求。
