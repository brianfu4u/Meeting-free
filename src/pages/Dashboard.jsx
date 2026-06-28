import React, { useState, useEffect, useCallback } from "react";
import TopBar from "@/components/dashboard/TopBar";
import Sidebar from "@/components/dashboard/Sidebar";
import PanelCard from "@/components/dashboard/PanelCard";
import PanelDrawer from "@/components/dashboard/PanelDrawer";
import EventStream from "@/components/dashboard/EventStream";
import StatsBar from "@/components/dashboard/StatsBar";
import {
  INITIAL_PANELS,
  PANEL_ORDER,
  EVENT_STREAM_INITIAL,
  EVENT_STREAM_QUEUE,
  NAV_ITEMS,
} from "@/data/mockData";

let eventIdCounter = 20;

export default function Dashboard() {
  const [panels, setPanels] = useState(INITIAL_PANELS);
  const [events, setEvents] = useState(EVENT_STREAM_INITIAL);
  const [activePanel, setActivePanel] = useState(null);
  const [activeSection, setActiveSection] = useState("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(false);
  const [actionDone, setActionDone] = useState(false);
  const [queueIndex, setQueueIndex] = useState(0);
  const [overallHealth, setOverallHealth] = useState(78);

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

  // Simulate metric fluctuations on patient flow / queue panels
  useEffect(() => {
    if (actionDone) return;
    const timer = setInterval(() => {
      setPanels((prev) => ({
        ...prev,
        patientFlow: {
          ...prev.patientFlow,
          metrics: prev.patientFlow.metrics.map((m) => {
            if (m.label === "今日已接诊") {
              const newVal = parseInt(m.value) + Math.floor(Math.random() * 2);
              return { ...m, value: String(newVal) };
            }
            if (m.label === "当前在院") {
              const newVal = Math.max(18, parseInt(m.value) + (Math.random() > 0.5 ? 1 : -1));
              return { ...m, value: String(newVal) };
            }
            return m;
          }),
        },
        queueCongestion: {
          ...prev.queueCongestion,
          metrics: prev.queueCongestion.metrics.map((m) => {
            if (m.label === "当前等待人数") {
              const newVal = Math.max(10, Math.min(18, parseInt(m.value) + (Math.random() > 0.5 ? 1 : -1)));
              return { ...m, value: String(newVal) };
            }
            return m;
          }),
        },
      }));
    }, 7000);
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

    // Update panels after confirmation
    setPanels((prev) => ({
      ...prev,
      queueCongestion: {
        ...prev.queueCongestion,
        status: "amber",
        liveNote: "支援已到位，拥堵正在缓解中",
        metrics: prev.queueCongestion.metrics.map((m) => {
          if (m.label === "拥堵指数") return { ...m, value: "54" };
          if (m.label === "超时等待") return { ...m, value: "1" };
          if (m.label === "平均等待时长") return { ...m, value: "16" };
          return m;
        }),
      },
      staffStatus: {
        ...prev.staffStatus,
        liveNote: "视光师X已调入支援，所有人员在岗",
        metrics: prev.staffStatus.metrics.map((m) => {
          if (m.label === "空闲可调配") return { ...m, value: "0" };
          if (m.label === "超负荷预警") return { ...m, value: "2" };
          return m;
        }),
      },
      operations: {
        ...prev.operations,
        status: "green",
        liveNote: "调度已完成，排班正常运行",
        metrics: prev.operations.metrics.map((m) => {
          if (m.label === "待调度任务") return { ...m, value: "2" };
          if (m.label === "已执行指令") return { ...m, value: "8" };
          return m;
        }),
      },
    }));
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

  const panelStatuses = Object.fromEntries(
    Object.entries(panels).map(([k, v]) => [k, v.status])
  );

  return (
    <div className="min-h-screen" style={{ background: "#0D1B2A" }}>
      <TopBar overallHealth={overallHealth} onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />

      <Sidebar
        navItems={NAV_ITEMS}
        activeSection={activeSection}
        onNavigate={setActiveSection}
        panelStatuses={panelStatuses}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main layout */}
      <div
        className="flex"
        style={{ paddingTop: "56px" }}
      >
        {/* Sidebar spacer on desktop */}
        <div className="hidden md:block flex-shrink-0" style={{ width: "200px" }} />

        {/* Main content */}
        <div className="flex-1 min-w-0 flex flex-col xl:flex-row gap-0">
          {/* Dashboard grid area */}
          <div className="flex-1 min-w-0 p-4 md:p-5">
            {/* Welcome banner */}
            <div
              className="rounded-xl px-5 py-3.5 mb-5 flex items-center justify-between"
              style={{
                background: "linear-gradient(135deg, rgba(0,199,217,0.08) 0%, rgba(0,153,168,0.04) 100%)",
                border: "1px solid rgba(0,199,217,0.15)",
              }}
            >
              <div>
                <div className="text-sm font-bold" style={{ color: "#F1F5F9" }}>
                  你好，店长L · 上午班正在进行中
                </div>
                <div className="text-xs mt-0.5" style={{ color: "#64748B" }}>
                  原来管好一家诊所，真的需要实时关注这么多板块。
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

            {/* Stats bar */}
            <div className="mb-4">
              <StatsBar panels={panels} />
            </div>

            {/* 9-panel grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {PANEL_ORDER.map((panelId) => {
                const panel = panels[panelId];
                return (
                  <PanelCard
                    key={panelId}
                    panel={panel}
                    onClick={(p) => {
                      setActivePanel(p);
                      setActiveSection(panelId);
                    }}
                  />
                );
              })}
            </div>
          </div>

          {/* Event stream on tablet/mobile (below grid) */}
          <div className="xl:hidden px-4 pb-6">
            <div style={{ height: "460px" }}>
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

        {/* Fixed event stream on XL */}
        <div
          className="hidden xl:flex flex-col flex-shrink-0"
          style={{
            width: "340px",
            height: "calc(100vh - 56px)",
            position: "sticky",
            top: "56px",
            padding: "20px 20px 20px 0",
          }}
        >
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

      {/* Detail drawer */}
      {activePanel && (
        <PanelDrawer
          panel={activePanel}
          onClose={() => setActivePanel(null)}
        />
      )}
    </div>
  );
}