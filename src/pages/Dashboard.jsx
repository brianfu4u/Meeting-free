import React, { useCallback } from "react";
import { GitBranch, Archive, BarChart3 } from "lucide-react";
import TopBar from "@/components/dashboard/TopBar";
import Sidebar from "@/components/dashboard/Sidebar";
import EventStream from "@/components/dashboard/EventStream";
import FourDimensionsPanel from "@/components/dashboard/FourDimensionsPanel";
import DimensionDrawer from "@/components/dashboard/DimensionDrawer";
import DailyReviewPanel from "@/components/dashboard/DailyReviewPanel";
import EventStreamMarquee from "@/components/dashboard/EventStreamMarquee";
import WorkflowSnapshotPanel from "@/components/dashboard/WorkflowSnapshotPanel";
import WorkflowClosureView from "@/components/dashboard/WorkflowClosureView";
import WorkflowTodaySummary from "@/components/dashboard/WorkflowTodaySummary";
import ManagerPanelDrawer from "@/components/dashboard/ManagerPanelDrawer";
import ReconcileBatchDrawer from "@/components/dashboard/ReconcileBatchDrawer";
import ReportHub from "@/components/dashboard/reports/ReportHub";
import { ThemeProvider, useTheme } from "@/lib/ThemeContext";
import { NAV_ITEMS } from "@/data/mockData";
import {
  useAuditLog,
  usePatientSessions,
  useStaff,
  useOperationalTasks,
  useAlerts,
  useInventory,
  deriveHealthScore,
  usePendingReconcileSnapshots,
  asList,
} from "@/hooks/useClinicData";
import { useLiveOpsFeed } from "@/hooks/useLiveOpsFeed";
import { formatBeijingTimeShort } from "@/lib/clinicTime";

// 将 AuditLog 实体映射为 EventStream 所需的展示结构
function mapAuditToEvent(entry) {
  const type = (() => {
    const t = entry.trigger_type || "";
    if (/STALLED|ESCALATED|REJECTED|BELOW_THRESHOLD|MISSED|EXCEPTION/i.test(t)) return "critical";
    if (/REPORT|DRAFT|SUGGEST|ATTENTION|RISK|GAP|MISSING/i.test(t)) return "warning";
    if (/COMPLETED|APPROVED|SEATED|ARRIVED|CHECKED|GENERATED/i.test(t)) return "success";
    return "info";
  })();
  const p = entry.payload || {};
  const parts = [];
  if (entry.source_agent) parts.push(`[${entry.source_agent.replace(/_V10$/, "")}]`);
  if (p.staff_name) parts.push(p.staff_name);
  if (p.patient_name) parts.push(`患者:${p.patient_name}`);
  if (p.text) parts.push(String(p.text).slice(0, 60));
  if (p.node_name) parts.push(`节点:${p.node_name}`);
  if (p.item_name) parts.push(`物品:${p.item_name}`);
  if (p.attention_title) parts.push(p.attention_title);
  if (parts.length === 0) parts.push(entry.trigger_type || "事件");
  return {
    id: entry.id || entry.event_id,
    time: formatBeijingTimeShort(new Date(entry.timestamp)),
    type,
    icon: "FileText",
    message: parts.join(" · "),
  };
}

function DashboardInner() {
  const { theme } = useTheme();
  const [activeDimension, setActiveDimension] = React.useState(null);
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [reconcileOpen, setReconcileOpen] = React.useState(false);
  const [snapshotOpen, setSnapshotOpen] = React.useState(false);
  const [closureOpen, setClosureOpen] = React.useState(false);
  const [reportOpen, setReportOpen] = React.useState(false);

  // 真实数据：事件流 + 健康分构成
  const auditQ = useAuditLog(20);
  const sessionsQ = usePatientSessions();
  const staffQ = useStaff();
  const tasksQ = useOperationalTasks();
  const alertsQ = useAlerts();
  const inventoryQ = useInventory();

  const liveEvents = asList(auditQ.data).map(mapAuditToEvent);
  const reconcileQ = usePendingReconcileSnapshots();
  const pendingReconcileCount = asList(reconcileQ.data).length;
  const overallHealth = deriveHealthScore(
    sessionsQ.data,
    tasksQ.data,
    alertsQ.data,
    inventoryQ.data
  );

  // 实时事件订阅：补入 AuditLog 之外的实时推送（如 PAD 心跳）
  const handleLiveEvent = useCallback((ev) => {
    // liveEvents 由 React Query 轮询驱动，此处仅保留钩子以备扩展
  }, []);
  useLiveOpsFeed(handleLiveEvent);

  return (
    <div className="min-h-screen" style={{ background: theme.canvas, transition: "background 0.3s ease" }}>
      <TopBar overallHealth={overallHealth} onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />

      <Sidebar
        navItems={NAV_ITEMS}
        activeSection="overview"
        onNavigate={() => {}}
        panelStatuses={{}}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        pendingReconcileCount={pendingReconcileCount}
        onOpenReconcile={() => setReconcileOpen(true)}
        onOpenSnapshot={() => setSnapshotOpen(true)}
        onOpenClosure={() => setClosureOpen(true)}
        onOpenReport={() => setReportOpen(true)}
      />

      {/* Main layout */}
      <div className="flex" style={{ paddingTop: "56px" }}>
        <div className="hidden md:block flex-shrink-0" style={{ width: "200px" }} />

        <div className="flex-1 min-w-0 p-4 md:p-5">
          {/* Welcome banner */}
          <div
            className="rounded-xl px-5 py-3.5 mb-4 flex items-center justify-between"
            style={{ background: theme.welcomeBg, border: `1px solid ${theme.welcomeBorder}` }}
          >
            <div>
              <div className="text-sm font-bold" style={{ color: theme.text }}>
                你好，店长L · 当前门店实时态势
              </div>
              <div className="text-xs mt-0.5" style={{ color: theme.textMuted }}>
                四维实时投影 · 聚焦人、流、钱、物。健康评分 {overallHealth}/100
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-2">
              <div
                className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                style={{ background: "rgba(0,199,217,0.12)", color: "#00C7D9", border: "1px solid rgba(0,199,217,0.25)" }}
              >
                Clinic OS V10 · 实时驱动
              </div>
            </div>
          </div>

          {/* 四维现实空间指挥台 */}
          <div className="mb-4">
            <FourDimensionsPanel onOpenDimension={setActiveDimension} />
          </div>

          {/* 事件流走马灯 — 战术层实时播报（当日）*/}
          <div className="mb-4">
            <EventStreamMarquee />
          </div>

          {/* 工作流今日摘要 — 当天只读态势，点击进入店长工作区查看完整操作与历史 */}
          <div className="mb-4">
            <WorkflowTodaySummary
              onOpenSnapshot={() => setSnapshotOpen(true)}
              onOpenClosure={() => setClosureOpen(true)}
            />
          </div>

          {/* 日结复盘 — 全宽，下班前一键总览 */}
          <div className="mb-4">
            <DailyReviewPanel />
          </div>

          {/* 系统事件流 — 全宽，按时间滚动 */}
          <div style={{ height: "calc(100vh - 520px)", minHeight: "260px" }}>
            <EventStream events={liveEvents} loading={auditQ.isLoading} />
          </div>
        </div>
      </div>

      {/* 维度详情抽屉 */}
      {activeDimension && (
        <DimensionDrawer
          dimension={activeDimension}
          onClose={() => setActiveDimension(null)}
        />
      )}

      {/* 闭环工作流批量核销入库抽屉 */}
      <ReconcileBatchDrawer open={reconcileOpen} onClose={() => setReconcileOpen(false)} />

      {/* 经营报告中心：人/流/钱/物 四维度统计，支持日/周/月/季 */}
      {reportOpen && (
        <ManagerPanelDrawer
          title="经营报告中心"
          subtitle="店长/投资人 · 人 流 钱 物"
          icon={BarChart3}
          accent="#FBBF24"
          onClose={() => setReportOpen(false)}
        >
          <ReportHub />
        </ManagerPanelDrawer>
      )}

      {/* 店长工作区：工作流快照完整视图（操作 + 历史） */}
      {snapshotOpen && (
        <ManagerPanelDrawer
          title="工作流快照"
          subtitle="店长工作区 · 闭环操作与历史"
          icon={GitBranch}
          accent="#8B5CF6"
          onClose={() => setSnapshotOpen(false)}
        >
          <WorkflowSnapshotPanel />
        </ManagerPanelDrawer>
      )}

      {/* 店长工作区：工作流闭环视图完整版（操作 + 归档历史） */}
      {closureOpen && (
        <ManagerPanelDrawer
          title="工作流闭环视图"
          subtitle="店长工作区 · 闭环决策与归档"
          icon={Archive}
          accent="#A78BFA"
          onClose={() => setClosureOpen(false)}
        >
          <WorkflowClosureView />
        </ManagerPanelDrawer>
      )}
    </div>
  );
}

export default function Dashboard() {
  return (
    <ThemeProvider>
      <DashboardInner />
    </ThemeProvider>
  );
}