// §3.2 超支允許機制 — 前端示範
// 當 Team 剩餘節數 < 0 時彈出警告，但治療師仍可選擇「繼續指派」
"use client";

import { useState } from "react";
import type { RemainingQuotaCheck } from "@/lib/allocation";

interface Props {
  check: RemainingQuotaCheck;
  /** 治療師確認繼續指派時呼叫；旗標 wasOverQuota 會寫入派單紀錄 */
  onConfirmAssign: (wasOverQuota: boolean) => void;
  children: React.ReactNode; // 觸發按鈕，例如 <button>指派</button>
}

export function AssignmentQuotaGuard({ check, onConfirmAssign, children }: Props) {
  const [showWarning, setShowWarning] = useState(false);

  const handleClick = () => {
    if (check.isOverQuota) {
      setShowWarning(true); // 超支 → 彈出警告
    } else {
      onConfirmAssign(false); // 配額內，直接指派
    }
  };

  return (
    <>
      <span onClick={handleClick} role="presentation">
        {children}
      </span>

      {showWarning && (
        <div
          role="alertdialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-rose-600">⚠️ 節數已超支，請注意</h3>
            <p className="mt-3 text-sm text-slate-700">
              <span className="font-semibold">{check.team}</span> {check.pool} 配額{" "}
              {check.quota} 節，已指派 {check.used} 節，剩餘{" "}
              <span className="font-bold text-rose-600">{check.remaining}</span> 節。
            </p>
            <p className="mt-2 text-sm text-slate-600">仍要繼續指派嗎？</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowWarning(false)}
                className="rounded-md border border-slate-300 bg-white px-4 py-1.5 text-sm hover:bg-slate-50"
              >
                取消
              </button>
              <button
                onClick={() => {
                  setShowWarning(false);
                  onConfirmAssign(true); // 標記為超支指派
                }}
                className="rounded-md bg-rose-600 px-4 py-1.5 text-sm text-white hover:bg-rose-700"
              >
                繼續指派
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
