/**
 * 经营报告 · 物 — 仪器使用与品牌销售
 * 仪器清单 / 使用次数 / 服役年限 / 品牌产品销售排行
 * 仪器使用：EvidenceFactCard 中含 device_serial 的事实卡按 business_date 计数，匹配 InventoryItem(equipment).sku
 * 品牌销售：收银小票事实卡（payment）字段中 brand/product_name 抽取聚合
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { useTheme } from "@/lib/ThemeContext";
import { inRangeDate } from "@/lib/reportRange";
import { Package, Cpu, Tag } from "lucide-react";

const CLINIC_ID = "clinic-001";

function yearsSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  return Math.round10((Date.now() - d.getTime()) / (365.25 * 86400000), 1);
}
const round10 = (n, p) => Math.round(n * Math.pow(10, p)) / Math.pow(10, p);

export default function AssetReport({ range }) {
  const { theme } = useTheme();
  const invQ = useQuery({
    queryKey: ["reportInventory", CLINIC_ID],
    queryFn: () => base44.entities.InventoryItem.filter({ clinic_id: CLINIC_ID, category: "equipment" }, "-created_date", 100),
    refetchInterval: 30000,
  });
  const examQ = useQuery({
    queryKey: ["reportExamCards", CLINIC_ID, range.start, range.end],
    queryFn: () => base44.entities.EvidenceFactCard.filter({ clinic_id: CLINIC_ID }, "-extracted_at", 500),
    refetchInterval: 30000,
  });
  const payQ = useQuery({
    queryKey: ["reportPayCardsBrand", CLINIC_ID, range.start, range.end],
    queryFn: () => base44.entities.EvidenceFactCard.filter({ clinic_id: CLINIC_ID, workflow_family_hint: "payment" }, "-extracted_at", 500),
    refetchInterval: 30000,
  });

  const equipment = invQ.data || [];
  const examCards = (examQ.data || []).filter((c) => c.device_serial && inRangeDate(c.business_date, range));
  const payCards = (payQ.data || []).filter((c) => inRangeDate(c.business_date, range));

  // 仪器使用次数：按 device_serial 计数
  const usageBySerial = {};
  for (const c of examCards) {
    const s = c.device_serial;
    usageBySerial[s] = (usageBySerial[s] || 0) + 1;
  }
  const totalUsage = examCards.length;
  const maxUsage = Math.max(1, ...Object.values(usageBySerial));

  // 品牌销售：从支付事实卡抽取 brand/product_name 字段聚合
  const brandCount = {};
  let branded = 0;
  for (const c of payCards) {
    const f = (c.fields || []).find((x) => /brand|品牌|product|商品|sku_name|品名/i.test(x.field_name));
    if (f && f.value) {
      brandCount[f.value] = (brandCount[f.value] || 0) + 1;
      branded += 1;
    }
  }
  const brandRanked = Object.entries(brandCount).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxBrand = brandRanked[0]?.[1] || 1;

  return (
    <div className="space-y-3">
      {/* 总览 */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-xl p-3" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
          <div className="flex items-center gap-1.5 mb-1">
            <Cpu size={13} style={{ color: "#A78BFA" }} />
            <span className="text-[10px]" style={{ color: theme.textMuted }}>仪器使用次数</span>
          </div>
          <div className="text-lg font-bold tabular-nums" style={{ color: "#A78BFA" }}>{totalUsage}</div>
          <div className="text-[9.5px]" style={{ color: theme.textFaint }}>在册 {equipment.length} 台</div>
        </div>
        <div className="rounded-xl p-3" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
          <div className="flex items-center gap-1.5 mb-1">
            <Tag size={13} style={{ color: "#00C7D9" }} />
            <span className="text-[10px]" style={{ color: theme.textMuted }}>品牌产品销售</span>
          </div>
          <div className="text-lg font-bold tabular-nums" style={{ color: "#00C7D9" }}>{branded}</div>
          <div className="text-[9.5px]" style={{ color: theme.textFaint }}>{brandRanked.length} 个品牌</div>
        </div>
      </div>

      {/* 仪器清单 */}
      <div className="rounded-xl p-3" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
        <div className="flex items-center gap-2 mb-2">
          <Package size={13} style={{ color: "#A78BFA" }} />
          <span className="text-xs font-bold" style={{ color: theme.text }}>仪器使用排行</span>
        </div>
        {equipment.length === 0 ? (
          <div className="py-4 text-center text-xs" style={{ color: theme.textFaint }}>未登记设备（InventoryItem.category=equipment）</div>
        ) : (
          <div className="space-y-1.5">
            {equipment
              .map((eq) => ({ eq, usage: usageBySerial[eq.sku] || 0 }))
              .sort((a, b) => b.usage - a.usage)
              .map(({ eq, usage }) => {
                const yrs = yearsSince(eq.purchase_date);
                return (
                  <div key={eq.id} className="flex items-center gap-2">
                    <span className="text-xs font-semibold flex-1 truncate" style={{ color: theme.text }}>{eq.item_name}</span>
                    {yrs !== null && <span className="text-[9.5px]" style={{ color: theme.textFaint }}>{yrs}年</span>}
                    <div className="w-24 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                      <div className="h-full rounded-full" style={{ width: `${(usage / maxUsage) * 100}%`, background: "#A78BFA" }} />
                    </div>
                    <span className="text-xs font-bold tabular-nums w-8 text-right" style={{ color: "#A78BFA" }}>{usage}</span>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* 品牌销售排行 */}
      <div className="rounded-xl p-3" style={{ background: theme.cardBg, border: `1px solid ${theme.border}` }}>
        <div className="flex items-center gap-2 mb-2">
          <Tag size={13} style={{ color: "#00C7D9" }} />
          <span className="text-xs font-bold" style={{ color: theme.text }}>品牌产品销售排行</span>
        </div>
        {brandRanked.length === 0 ? (
          <div className="py-4 text-center">
            <div className="text-xs" style={{ color: theme.textFaint }}>小票未抽取品牌/品名字段</div>
            <div className="text-[10px] mt-1" style={{ color: theme.textFaint }}>建议在证据解析中补充 brand / product_name 字段</div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {brandRanked.map(([name, cnt], i) => (
              <div key={name} className="flex items-center gap-2">
                <span className="text-[10px] w-4 text-center" style={{ color: i < 3 ? "#00C7D9" : theme.textFaint }}>{i + 1}</span>
                <span className="text-xs font-semibold flex-1 truncate" style={{ color: theme.text }}>{name}</span>
                <div className="w-24 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                  <div className="h-full rounded-full" style={{ width: `${(cnt / maxBrand) * 100}%`, background: "linear-gradient(90deg,#00C7D9,#4ade80)" }} />
                </div>
                <span className="text-xs font-bold tabular-nums w-8 text-right" style={{ color: "#00C7D9" }}>{cnt}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}