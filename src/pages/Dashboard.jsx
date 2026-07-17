import React, { useState, useEffect, useCallback } from "react";
import TopBar from "@/components/dashboard/TopBar";
import Sidebar from "@/components/dashboard/Sidebar";
import EventStream from "@/components/dashboard/EventStream";
import FourDimensionsPanel from "@/components/dashboard/FourDimensionsPanel";
import DimensionDrawer from "@/components/dashboard/DimensionDrawer";
import AttentionQueue from "@/components/dashboard/AttentionQueue";
import WorkflowSnapshotPanel from "@/components/dashboard/WorkflowSnapshotPanel";
import { ThemeProvider, useTheme } from "@/lib/ThemeContext";
import {
  EVENT_STREAM_INITIAL,
  EVENT_STREAM_QUEUE,
  NAV_ITEMS,
} from "@/data/mockData";
import { useLiveOpsFeed } from "@/hooks/useLiveOpsFeed";

let eventIdCounter = 20;

function DashboardInner() {
  const { theme } = useTheme();
  const [events, setEvents] = useState(EVENT_STREAM_INITIAL);
  const [activeDimension, setActiveDimension] = useState(null);
  const [activeSection, setActiveSection] = useState("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(false);
  const [actionDone, setActionDone] = useState(false);
  const [queueIndex, setQueueIndex] = useState(0);
  const [overallHealth, setOverallHealth] = useState(78);

  // 实时事件订阅：员工打卡 / 汇报 / 扫码 / 告警秒级回显到中央看板
  const handleLiveEvent = useCallback((ev) => {
    setEvents((prev) => [ev, ...prev].slice(0, 20));
  }, []);
  useLiveOpsFeed(handleLiveEvent);

  // Auto-append events from queue
  useEffect(() => {
    const timer = setInterval(() => {
      setQueueIndex((prev) => {
        const nextIdx = prev % EVENT_STREAM_QUEUE.length;
        const nextEvent = {
          ...EVENT_STREAM_QUEUE[nextIdx],
          id: eventIdCounter++,
          time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
        };
        setEvents((prevEvents) => [nextEvent, ...prevEvents].slice(0, 20));
        if (nextEvent.awaitConfirm && !actionDone) {
          setPendingAction(true);
        }
        return prev + 1;
      });
    }, 9000);
    return () => clearInterval(timer);
  }, [actionDone]);

  const handleConfirm = useCallback(() => {
    setPendingAction(false);
    setActionDone(true);
    setOverallHealth(88);
    const confirmEvent = {
      id: eventIdCounter++,
      time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      type: "success",
      icon: "CheckCircle",
      message: "✅ 店长已确认调整。视光师X已接到调度通知，即刻前往检查区3号位支援。",
      actionRequired: false,
    };
    setEvents((prev) => [confirmEvent, ...prev]);
  }, []);

  const handleDispatch = useCallback(() => {
    const dispatchEvent = {
      id: eventIdCounter++,
      time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      type: "success",
      icon: "Zap",
      message: "📡 指令已下发至视光师X：立即前往检查区3号位执行支援任务。",
      actionRequired: false,
    };
    setEvents((prev) => [dispatchEvent, ...prev]);
    handleConfirm();
  }, [handleConfirm]);

  const handleDefer = useCallback(() => {
    setPendingAction(false);
    const deferEvent = {
      id: eventIdCounter++,
      time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      type: "warning",
      icon: "Clock",
      message: "⏱ 店长已选择稍后处理。系统将在10分钟后再次提醒。",
      actionRequired: false,
    };
    setEvents((prev) => [deferEvent, ...prev]);
    setTimeout(() => setPendingAction(true), 60000);
  }, []);

  const handleEscalate = useCallback(() => {
    setPendingAction(false);
    const escalateEvent = {
      id: eventIdCounter++,
      time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      type: "critical",
      icon: "AlertTriangle",
      message: "🚨 已升级处理，通知护士长N1介入协调。请在5分钟内给出处置方案。",
      actionRequired: false,
    };
    setEvents((prev) => [escalateEvent, ...prev]);
  }, []);

  return (
    <div className="min-h-screen" style={{ background: theme.canvas, transition: "background 0.3s ease" }}>
      <TopBar overallHealth={overallHealth} onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />

      <Sidebar
        navItems={NAV_ITEMS}
        activeSection={activeSection}
        onNavigate={setActiveSection}
        panelStatuses={{}}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main layout */}
      <div className="flex" style={{ paddingTop: "56px" }}>
        {/* Sidebar spacer on desktop */}
        <div className="hidden md:block flex-shrink-0" style={{ width: "200px" }} />

        {/* Main content — single column */}
        <div className="flex-1 min-w-0 p-4 md:p-5">
          {/* Welcome banner */}
          <div
            className="rounded-xl px-5 py-3.5 mb-4 flex items-center justify-between"
            style={{ background: theme.welcomeBg, border: `1px solid ${theme.welcomeBorder}` }}
          >
            <div>
              <div className="text-sm font-bold" style={{ color: theme.text }}>
                你好，店长L · 上午班正在进行中
              </div>
              <div className="text-xs mt-0.5" style={{ color: theme.textMuted }}>
                四维实时投影 · 聚焦人、流、钱、物。
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-2">
              <div
                className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                style={{ background: "rgba(0,199,217,0.12)", color: "#00C7D9", border: "1px solid rgba(0,199,217,0.25)" }}
              >
                周六上午班 08:00–13:00
              </div>
            </div>
          </div>

          {/* 四维现实空间指挥台 */}
          <div className="mb-4">
            <FourDimensionsPanel onOpenDimension={setActiveDimension} />
          </div>

          {/* V10 双层架构：注意力队列（战术）+ 工作流快照（战略）*/}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <AttentionQueue />
            <WorkflowSnapshotPanel />
          </div>

          {/* 实时事件流 — 全宽，按时间滚动 */}
          <div style={{ height: "calc(100vh - 520px)", minHeight: "320px" }}>
            <EventStream
              events={events}
              pendingAction={pendingAction}
              onConfirm={handleConfirm}
              onDispatch={handleDispatch}
              onDefer={handleDefer}
              onEscalate={handleEscalate}
              actionDone={actionDone}
            />
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