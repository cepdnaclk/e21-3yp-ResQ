import type { CalibrationProfileResponse } from "../../types/firmware";

type CalibrationProfileCardProps = {
  profile: CalibrationProfileResponse | null;
  loading?: boolean;
};

export function CalibrationProfileCard({ profile, loading }: CalibrationProfileCardProps) {
  if (loading) {
    return (
      <div className="bg-white border border-slate-100 rounded-2xl p-6 animate-pulse space-y-4">
        <div className="h-4 bg-slate-100 rounded w-1/3" />
        <div className="grid grid-cols-2 gap-4">
          <div className="h-10 bg-slate-50 rounded" />
          <div className="h-10 bg-slate-50 rounded" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="bg-slate-50 border border-dashed border-slate-200 rounded-2xl p-6 text-center text-slate-400 text-xs font-semibold">
        No calibration profile selected.
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h4 className="text-sm font-black text-slate-800">{profile.name}</h4>
          {profile.description && (
            <p className="text-[11px] text-slate-400 mt-1 font-medium">{profile.description}</p>
          )}
        </div>
        {profile.defaultProfile && (
          <span className="text-[9px] font-extrabold bg-teal-50 text-teal-700 px-2 py-0.5 rounded border border-teal-100 uppercase tracking-wider">
            Default
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-50/60 p-3.5 rounded-xl border border-slate-100/50">
          <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">
            Hall Movement Target
          </span>
          <span className="text-base font-black font-mono text-slate-700 mt-1 block">
            {profile.hallDelta}
          </span>
        </div>
        <div className="bg-slate-50/60 p-3.5 rounded-xl border border-slate-100/50">
          <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">
            Reference Pressure
          </span>
          <span className="text-base font-black font-mono text-slate-700 mt-1 block">
            {profile.refPressure}
          </span>
        </div>
        <div className="bg-slate-50/60 p-3.5 rounded-xl border border-slate-100/50">
          <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">
            Left Bladder Pressure
          </span>
          <span className="text-base font-black font-mono text-slate-700 mt-1 block">
            {profile.bladder1Pressure}
          </span>
        </div>
        <div className="bg-slate-50/60 p-3.5 rounded-xl border border-slate-100/50">
          <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">
            Right Bladder Pressure
          </span>
          <span className="text-base font-black font-mono text-slate-700 mt-1 block">
            {profile.bladder2Pressure}
          </span>
        </div>
      </div>
    </div>
  );
}
