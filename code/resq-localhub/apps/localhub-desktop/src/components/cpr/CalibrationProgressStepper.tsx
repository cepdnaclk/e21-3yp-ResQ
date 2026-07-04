type CalibrationProgressStepperProps = {
  progressId: number | null | undefined;
};

export function CalibrationProgressStepper({ progressId }: CalibrationProgressStepperProps) {
  const hasProgress = progressId !== null && progressId !== undefined && progressId >= 0;
  const progressPercent = hasProgress ? Math.min(100, Math.max(0, progressId!)) : null;

  return (
    <div className="bg-slate-50 border border-slate-100 rounded-2xl p-6 space-y-5">
      <div className="flex justify-between items-center">
        <span className="text-xs font-extrabold text-slate-400 uppercase tracking-widest">
          Calibration Pre-Check Progress
        </span>
        <span className="text-xs font-black text-teal-600 font-mono">
          {progressPercent !== null ? `${progressPercent}%` : "Running..."}
        </span>
      </div>

      <div className="h-2.5 w-full bg-slate-200/70 rounded-full overflow-hidden relative">
        {progressPercent !== null ? (
          <div
            className="h-full bg-teal-600 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        ) : (
          <div className="h-full bg-teal-600 rounded-full w-2/3 animate-pulse" />
        )}
      </div>

      <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider pt-2">
        <div className="flex items-center gap-1.5 text-teal-600">
          <span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-ping" />
          <span>1. Initializing</span>
        </div>
        <div
          className={`flex items-center gap-1.5 ${
            progressPercent === null || progressPercent >= 33 ? "text-teal-600" : ""
          }`}
        >
          {progressPercent !== null && progressPercent >= 33 && (
            <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
          )}
          <span>2. Chamber Tests</span>
        </div>
        <div
          className={`flex items-center gap-1.5 ${
            progressPercent !== null && progressPercent >= 75 ? "text-teal-600" : ""
          }`}
        >
          {progressPercent !== null && progressPercent >= 75 && (
            <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
          )}
          <span>3. Calibration PASS</span>
        </div>
      </div>
    </div>
  );
}
export default CalibrationProgressStepper;
