import type { CompletedSession } from "../../types/session";
import Card from "../ui/Card";
import Button from "../ui/Button";
import StatusBadge from "../ui/StatusBadge";
import {
  formatDateTime,
  formatDuration,
  getScoreLabel,
  getScoreTone,
} from "../../utils/userFriendlyLabels";

type SessionCardProps = {
  session: CompletedSession;
  onSelect: (sessionId: string) => void;
};

export function SessionCard({ session, onSelect }: SessionCardProps) {
  const score = session.summary?.score ?? 0;
  const scoreTone = getScoreTone(score);
  const label = getScoreLabel(score);

  const badgeTone: "success" | "info" | "warning" | "danger" | "muted" =
    scoreTone === "excellent"
      ? "success"
      : scoreTone === "good"
      ? "info"
      : scoreTone === "fair"
      ? "warning"
      : "danger";

  return (
    <Card className="hover:border-slate-300 hover:shadow-[0_8px_24px_rgba(15,23,42,0.04)] transition-all duration-300 flex flex-col justify-between">
      <div className="space-y-4">
        <div className="flex justify-between items-start">
          <div className="space-y-0.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Trainee Code</span>
            <span className="font-bold text-slate-800 text-base">{session.traineeId || "Anonymous"}</span>
          </div>
          <StatusBadge tone={badgeTone} label={`${score}% - ${label}`} dot={false} />
        </div>

        <div className="grid grid-cols-2 gap-4 bg-slate-50/50 p-3 rounded-xl border border-slate-100/30 text-xs">
          <div>
            <span className="text-slate-400 block font-semibold mb-0.5">Session Date</span>
            <span className="text-slate-700 font-medium">{formatDateTime(session.startedAt)}</span>
          </div>
          <div>
            <span className="text-slate-400 block font-semibold mb-0.5">Duration</span>
            <span className="text-slate-700 font-mono font-bold">{formatDuration(session.summary?.durationSeconds)}</span>
          </div>
        </div>
      </div>

      <div className="border-t border-slate-100/60 pt-3 mt-4 flex justify-end">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-full sm:w-auto bg-white font-bold"
          onClick={() => onSelect(session.sessionId)}
        >
          Review Details
        </Button>
      </div>
    </Card>
  );
}

export default SessionCard;
