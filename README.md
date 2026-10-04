# 水文监测站网管理系统

面向水文监测站点运行、水位流量雨量数据采集、遥测设备维护与数据整编发布的水文站网管理平台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 监测站点 | `station` | 水文监测站 | 站点编号、站点名称、站点类型 |
| 水位监测 | `waterlevel` | 水位记录 | 记录编号、站点编号、观测时间 |
| 流量监测 | `discharge` | 流量记录 | 记录编号、站点编号、测量方法 |
| 雨量观测 | `rainfall` | 雨量记录 | 记录编号、站点编号、观测时段 |
| 水质检测 | `waterquality` | 水质检测报告 | 报告编号、采样站点、采样时间 |
| 断面测量 | `crosssection` | 断面测量记录 | 记录编号、站点编号、断面名称 |
| 遥测设备 | `telemetry` | 遥测设备 | 设备编号、设备类型、所属站点 |
| 数据整编 | `compilation` | 整编成果 | 成果编号、整编年份、站点编号 |
| 预警阈值 | `warning` | 预警阈值配置 | 配置编号、站点编号、监测类型 |
| 地下水观测 | `groundwater` | 地下水观测记录 | 记录编号、井点编号、观测日期 |
| 蒸发观测 | `evaporation` | 蒸发观测记录 | 记录编号、站点编号、观测日期 |
| 测流缆道 | `cableway` | 测流缆道 | 缆道编号、所属站点、跨度米数 |
| 泥沙监测 | `sediment` | 泥沙监测记录 | 记录编号、站点编号、采样时间 |
| 通讯系统 | `communication` | 通讯设备 | 设备编号、设备类型、所属站点 |
| 站房维护 | `stationhouse` | 站房维护记录 | 记录编号、站点编号、维护类型 |
| 仪器检定 | `calibration` | 仪器检定记录 | 记录编号、仪器编号、仪器名称 |
| 巡检记录 | `inspection` | 巡检记录 | 记录编号、站点编号、巡检日期 |
| 测报方案 | `plan` | 测报方案 | 方案编号、方案名称、适用范围 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `hydrology-monitor-station:entries` 这一项，或调用 `resetModule(模块)`。

## 雨量复核与整编链路

- 雨量列表（`views/rainfall/index.vue`）点「复核」进入复核详情（`views/rainfall/review.vue`，
  路由 `/rainfall/:id/review`）：详情展示只读原始观测值、自动核对「同站当日各时段雨量合计 vs
  日累计雨量」，核对清单逐项勾选后只能落**一条**复核结论（通过 / 异常）。
- 结论（`EntryRow.review`）与整编标记（`EntryRow.compiled`）直接随业务行整行持久化；
  刷新页面、重新进入、返回列表都从同一份 `localStorage` 数据回显，原结论不丢、旧值不残留。
- 旧版本数据缺少这些字段时，由 `local-store.ts` 的 `normalizeRow` 在读取时补缺省值
  （`review=null`、`compiled=false`），**不改动任何原始观测字段**；字符串数字由
  `parseAmount` 兼容解析。
- 重复复核：内容完全相同走幂等不重复落库；内容不同则覆盖同一条结论并把 `revision+1`。
  并发提交由每条记录一把提交锁（`inflight`）串行化，只有首个提交生效。
- 打印报表（`views/rainfall/report.vue`，路由 `/rainfall/report`）与列表共用
  `listEntries` 数据源和筛选条件，保证列表与报表一致；报表支持浏览器打印与 CSV 导出。
- 整编待办（`views/compilation/index.vue`）通过 `pendingCompilationTodos()` 实时取
  「复核通过且未整编」的雨量记录，核对整编清单全部勾选后 `markCompiled` 编入成果（幂等）。
- 水位、流量、地下水、蒸发、泥沙、水质、断面模块复用通用复核详情
  （`views/review/index.vue`，路由 `/review/:module/:id`）与共享核对清单组件
  （`components/ReviewChecklist.vue`），清单内容在 `modules.ts` 的 `checklist` 配置。
