# Phase 5 Batch 1 — Acceptance Marker

> 本文件作为 phase5/multimodal-ingestion 分支的验收锚点。Phase 5 Batch 1 的统一入站接口
> `fragmentIngestionService` 已通过 Base44 双向同步落地至 main（commit 234c9a76，base44-builder[bot]，
> 2026-07-20T04:20:53Z）。本 PR 用于版本追踪与 CI 验收，不重复提交已落地代码。

## 已落地文件（main HEAD 234c9a76）

### 后端函数 fragmentIngestionService（7）
- function.jsonc / contract.ts / security.ts / adapters.ts / alignment.ts / qualityGate.ts / entry.ts

### 实体 Schema（3）
- Artifact.jsonc（追加 12 字段）/ FragmentProcessingResult.jsonc（新增）/ EvidenceFactCard.jsonc（追加 9 字段）

### 脚本（2）
- scripts/phase5-isolated-e2e.mjs / scripts/phase5-cleanup.mjs

### 文档（1）
- docs/CLINIC_OS_PHASE5.md

### 单元测试（3）
- contract.test.js / security.test.js / qualityGate.test.js

## 与 PR #32 的关系

PR #32（phase5/photo-capture-shadow）实现独立照片采集入口（compositionOrchestrator/photoCapture.ts +
CompositionPhotoCapture.jsx + photoCapture.js）。本 PR 保留统一 fragmentIngestionService 作为唯一入站接口。
按"禁止保留两套 ingestion 实现"要求，PR #32 被替代并关闭。照片采集由 image Adapter 统一提供。

## Mock 模式

FRAGMENT_INGESTION_MOCK=true。仅验证合成接口、状态机、幂等、安全、清理。
未验证真实 Vision/OCR、ExtractDataFromUploadedFile、TranscribeAudio。

## 验收条件

- [x] Draft PR 可访问
- [ ] CI 绿色
- [x] function deploy 成功
- [ ] 合成四模态 E2E 真实输出
- [ ] 幂等/越权/错误格式真实输出
- [ ] cleanup_all_zero=true
- [x] clinic-001 只读未变化
