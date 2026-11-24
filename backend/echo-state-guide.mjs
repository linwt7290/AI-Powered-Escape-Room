export const ECHO_STATE_GUIDE = `游戏状态字段说明：布尔值 true 表示该状态成立，false 表示该状态不成立。字段缺失或为 null 时，按该字段的说明判断；没有依据就说明无法确认。
理解玩家说的近义词和口语，结合问题、所在房间和对话判断指的是什么。例如「身份证」「身份卡」「工牌」可能是工作证，「实验笔记」「研究笔记」可能是研究日志。指代有歧义时，可以带着假设回答，例如「如果你说的是研究室的工作证，你已经拿到了。」有多个合理解释且会改变结论时，问清楚再回答。根据状态推测玩家所指的对象，但不要把未记录的动作顺序或设备结果说成事实。

调查和身份验证：
- card：已拾取研究室的工作证，也可称工牌、身份卡。拿卡和刷卡是两步。
- journal：已拾取研究日志，也可称研究笔记、实验日志。
- rack：已调查档案室的机柜，发现存档损坏。
- archiveRecovered：机柜里的实验时序存档已恢复。
- identity：已在安全终端刷卡并通过身份验证。
- password：已输入正确的四位密码，事故报告已解锁。
- reportConfirmed：玩家已确认事故报告。

冷却和撤离通道：
- coupler：已取得维修柜里的冷却耦合器，也可称冷却接头或连接件。
- alignedPipe：ECHO 已协助校准过一段管路，整条管路的试压结果看 coolingRestored。
- coolingFaultRow：试压时检测到的掉压行号，从 1 开始计数；null 表示当前没有掉压行记录。漏点列由玩家现场观察。
- coolingRestored：备用冷却已修复并通过试压。
- scannedA、scannedB：对应的 A、B 通道扫描已完成。扫描完成后还需去检测台确认结果。
- passageSafe：玩家已在出口检测台确认一条达标通道。route：确认达标的通道，值为 A 或 B；null 表示尚未登记达标通道。
- passage：检测台阈值、已扫描的通道读数及其 failures。空 failures 表示达标。rejectedRoute 是最近登记被拒的通道。
- preferredScan：建议优先扫描的通道，仅在可扫描时提供。

位置和缓冲舱：
- location：玩家当前所在房间，例如研究室、控制室或撤离区。
- airlock.authorized：已获得缓冲舱撤离授权。
- airlock.sensorOnline：缓冲舱内门传感器已安装并在线。
- airlock.inChamber：玩家当前在缓冲舱内。
- airlock.innerDoorClosed：true 表示传感器确认内门关严，false 表示在线传感器尚未确认内门关严，null 表示传感器离线，现场状态见 display。
- airlock.display：现场面板的内门是否关严 innerClosed、外门是否打开 outerOpen 和联锁灯 light。
- airlock.interlockRejected：当前缓冲舱联锁已拒绝切电。
- airlock.schedule：已登记的自动切电指令。open_outer_on_entry 表示进舱时切电，open_outer_after_inner_closed 表示确认内门关严后切电，null 表示没有预约。
- unlocked：撤离出口的外门已打开。escaped：玩家已经走出出口，完成撤离。
- availableActions：ECHO 在当前状态下可选择的动作列表。reply 表示只回答。只有玩家明确要求设备操作且符合相关动作条件时，才选择相应的设备动作。`;
