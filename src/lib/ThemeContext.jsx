import React, { createContext, useContext, useState } from "react";

export const THEMES = {
  night: {
    name: "night",
    canvas: "#0D1B2A",
    cardBg: "#1E293B",
    cardHover: "#263347",
    border: "#2D3F55",
    borderSubtle: "#1E3352",
    topbar: "rgba(10,22,40,0.97)",
    sidebar: "rgba(13,27,42,0.98)",
    eventBg: "#111F30",
    drawerBg: "#111F30",
    drawerHeader: "#0D1B2A",
    metricCard: "#1E293B",
    metricCardBorder: "#2D3F55",
    subRowEven: "rgba(255,255,255,0.01)",
    statsBar: "#111F30",
    statsBarBorder: "#1E3352",
    welcomeBg: "linear-gradient(135deg, rgba(0,199,217,0.08) 0%, rgba(0,153,168,0.04) 100%)",
    welcomeBorder: "rgba(0,199,217,0.15)",
    text: "#F1F5F9",
    textSub: "#94A3B8",
    textMuted: "#64748B",
    textFaint: "#475569",
    textFaintest: "#334155",
    textMsg: "#CBD5E1",
    panelCardBg: "linear-gradient(135deg, #1E293B 0%, #1A2535 100%)",
    panelCardBorder: "#2D3F55",
    actionAreaBg: "rgba(0,0,0,0.2)",
    deferBtn: "rgba(255,255,255,0.05)",
    deferBtnBorder: "rgba(255,255,255,0.08)",
    deferBtnText: "#94A3B8",
    shiftInfoBg: "rgba(0,199,217,0.06)",
    shiftInfoBorder: "rgba(0,199,217,0.12)",
    scrollbarThumb: "#334155",
    chartTooltipBg: "#0D1B2A",
    chartTooltipBorder: "#1E3352",
  },
  day: {
    name: "day",
    canvas: "#F0F4F8",
    cardBg: "#FFFFFF",
    cardHover: "#F8FAFC",
    border: "#CBD5E1",
    borderSubtle: "#E2E8F0",
    topbar: "rgba(255,255,255,0.97)",
    sidebar: "rgba(248,250,252,0.98)",
    eventBg: "#FFFFFF",
    drawerBg: "#FFFFFF",
    drawerHeader: "#F8FAFC",
    metricCard: "#F8FAFC",
    metricCardBorder: "#E2E8F0",
    subRowEven: "rgba(0,0,0,0.02)",
    statsBar: "#FFFFFF",
    statsBarBorder: "#E2E8F0",
    welcomeBg: "linear-gradient(135deg, rgba(0,199,217,0.06) 0%, rgba(0,153,168,0.03) 100%)",
    welcomeBorder: "rgba(0,199,217,0.2)",
    text: "#1E293B",
    textSub: "#475569",
    textMuted: "#64748B",
    textFaint: "#94A3B8",
    textFaintest: "#CBD5E1",
    textMsg: "#334155",
    panelCardBg: "linear-gradient(135deg, #FFFFFF 0%, #F8FAFC 100%)",
    panelCardBorder: "#E2E8F0",
    actionAreaBg: "rgba(0,0,0,0.03)",
    deferBtn: "rgba(0,0,0,0.04)",
    deferBtnBorder: "rgba(0,0,0,0.08)",
    deferBtnText: "#64748B",
    shiftInfoBg: "rgba(0,199,217,0.05)",
    shiftInfoBorder: "rgba(0,199,217,0.15)",
    scrollbarThumb: "#CBD5E1",
    chartTooltipBg: "#FFFFFF",
    chartTooltipBorder: "#E2E8F0",
  },
};

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState("night");
  const theme = THEMES[mode];
  const toggleTheme = () => setMode((m) => (m === "night" ? "day" : "night"));
  return (
    <ThemeContext.Provider value={{ theme, mode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}