import Button from "./Button";

type ErrorStateProps = {
  title?: string;
  message: string;
  onRetry?: () => void;
};

export function ErrorState({ title = "Something went wrong", message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-6 text-center gap-4 bg-rose-50/50 rounded-2xl border border-rose-100/60 max-w-lg mx-auto">
      <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center">
        <svg className="w-6 h-6 text-rose-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>
      </div>
      <div>
        <h3 className="text-base font-bold text-slate-800 tracking-tight leading-tight">{title}</h3>
        <p className="mt-1.5 text-sm text-slate-500 leading-relaxed font-normal">{message}</p>
      </div>
      {onRetry && (
        <Button
          type="button"
          onClick={onRetry}
          variant="secondary"
          size="sm"
          className="mt-1 bg-white"
        >
          Try again
        </Button>
      )}
    </div>
  );
}

export default ErrorState;
