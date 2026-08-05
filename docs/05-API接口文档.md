# 05 · API 接口文档（v1.0）

基础约定：
- 协议：HTTP（局域网），JSON 请求体（`Content-Type: application/json`），`credentials: same-origin`。
- 认证：登录后服务端下发 `lumasign_sid` Cookie（HttpOnly, SameSite=Strict）；管理端 API 通过 Cookie 鉴权，部分接口支持 `x-session` 头。
- 统一响应：`{ "ok": true, ...字段 }`；失败：`{ "ok": false, "error": "消息" }`，HTTP 状态对应 4xx/5xx。
- 权限：管理端接口标注所需权限点（管理员 `*` 拥有全部）；终端接口使用 `terminalId` + `token` 令牌鉴权。

## 一、认证（管理端）

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | 公开 | 登录，返回 `{ sid, user, mustChangePassword }` 并种 Cookie |
| POST | `/api/auth/logout` | 登录 | 注销，清除 Cookie |
| GET | `/api/auth/me` | 登录 | 当前用户与权限目录 |
| POST | `/api/auth/password` | 登录 | 修改密码（需原密码，强度校验） |

## 二、仪表盘与事件

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/dashboard` | `dashboard:view` | 统计、近 7 天趋势、告警、最近终端、审计 |
| GET | `/api/events` | 登录 | 管理端 SSE 事件流（终端上下线、指令 ACK 等） |
| GET | `/api/alerts` | `dashboard:view` | 告警列表 |
| POST | `/api/alerts/:id/resolve` | `terminal:edit` | 标记告警已处理 |

## 三、机构 / 分组

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET/POST | `/api/orgs` | `terminal:view` / `system:setting` | 机构树列表 / 新建 |
| PUT/DEL | `/api/orgs/:id` | `system:setting` | 编辑 / 删除机构 |
| GET/POST | `/api/groups` | `terminal:view` / `terminal:edit` | 终端分组列表 / 新建 |
| PUT/DEL | `/api/groups/:id` | `terminal:edit` | 编辑 / 删除分组 |

## 四、终端

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/terminals` | `terminal:view` | 终端列表（支持 `?q=&status=&groupId=`） |
| GET | `/api/terminals/:id` | `terminal:view` | 终端详情 |
| GET | `/api/terminals/:id/shot/:file` | `terminal:view` | 查看截屏图片 |
| PUT | `/api/terminals/:id` | `terminal:edit` | 编辑终端属性 |
| POST | `/api/terminals/:id/approve` | `terminal:approve` | 批准接入 |
| DEL | `/api/terminals/:id` | `terminal:delete` | 删除终端 |
| POST | `/api/terminals/command` | `terminal:control` | 批量下发指令 `{ terminalIds, type, payload }` |

## 五、素材库

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/media` | `media:view` | 素材列表 |
| POST | `/api/media/upload` | `media:upload` | 上传（multipart `file`，SHA-256 去重） |
| GET | `/api/media/:id/raw` | `media:view` | 下载原始文件 |
| PUT/DEL | `/api/media/:id` | `media:upload` / `media:delete` | 编辑 / 删除 |
| POST/DEL | `/api/media/folders[/:id]` | `media:upload` / `media:delete` | 素材文件夹管理 |

## 六、节目（Layout）

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/layouts` | `layout:view` | 节目列表 |
| GET | `/api/layouts/:id` | `layout:view` | 节目详情 `{ item, media }` |
| POST | `/api/layouts` | `layout:edit` | 新建节目 |
| PUT | `/api/layouts/:id` | `layout:edit` | 保存（内容变更触发重新审批） |
| POST | `/api/layouts/:id/duplicate` | `layout:edit` | 另存为副本 |
| DEL | `/api/layouts/:id` | `layout:delete` | 删除 |
| POST | `/api/layouts/:id/submit` | `layout:submit` | 提交审批 |
| POST | `/api/layouts/:id/approve` | `layout:approve` | 审批通过 |
| GET/POST | `/api/layouts/:id/export` · `/api/layouts/import` | `layout:view` / `layout:edit` | 导出 / 导入 JSON |

## 七、排期 / 审批

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/schedules` | `schedule:view` | 排期列表 |
| POST/PUT/DEL | `/api/schedules[/:id]` | `schedule:edit` | 新建 / 编辑 / 删除排期 |
| POST | `/api/schedules/:id/publish` | `schedule:publish` | 发布下发 |
| GET | `/api/approvals` | `layout:view` | 待审批节目列表 |

## 八、用户 / 角色 / 设置

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET/POST | `/api/users` | `user:view` / `user:edit` | 用户列表 / 新建 |
| PUT/DEL | `/api/users/:id` | `user:edit` | 编辑 / 删除用户 |
| GET/POST | `/api/roles` | `user:view` / `role:edit` | 角色列表 / 新建 |
| PUT/DEL | `/api/roles/:id` | `role:edit` | 编辑 / 删除角色 |
| GET/PUT | `/api/settings` | `dashboard:view` / `system:setting` | 读取 / 保存系统设置 |

## 九、日志 / 播放证明

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/logs` | `log:view` | 日志查询（`?kind=audit|task|play&from=&to=&limit=`） |
| GET | `/api/logs/export` | `log:view` | 日志导出 |

## 十、终端侧 API（`/api/t/*`，令牌鉴权）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/t/register` | 注册（mac/serial 幂等），返回 `terminalId` + `token` |
| POST | `/api/t/heartbeat` | 心跳（上报 IP/存储/音量/正在播放） |
| GET | `/api/t/manifest?terminalId=&token=` | 拉取排期清单 `{ schedules, assets }` |
| GET | `/api/t/events` | 指令 SSE 通道（接收 command，自动 ACK 回执） |
| GET | `/api/t/poll` | 长轮询降级（老 WebView 无 SSE 时） |
| POST | `/api/t/ack` | 指令回执 `{ cmdId, ok, message }` |
| GET | `/api/t/media/:hash` | 素材下载（HTTP Range + 限速 + 校验） |
| POST | `/api/t/shot` | 上传截屏 |
| POST | `/api/t/log` | 上报播放日志（用于播放证明） |
| GET | `/api/t/apk` | 升级包下载 |

> 播放端只需实现：注册 → 心跳 → 拉清单 → 渲染 → SSE/poll 收指令 → ACK；其余（审批、排期、权限）均由服务端完成。
