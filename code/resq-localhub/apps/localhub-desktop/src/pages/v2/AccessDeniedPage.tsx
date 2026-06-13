import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";

type AccessDeniedPageProps = {
  onBackToHome?: () => void;
};

export function AccessDeniedPage({ onBackToHome }: AccessDeniedPageProps) {
  function handleGoHome() {
    if (onBackToHome) {
      onBackToHome();
    } else {
      window.location.assign("/");
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Card className="max-w-md w-full text-center py-12 px-6">
        <div className="mx-auto w-12 h-12 rounded-full bg-red-100 flex items-center justify-center text-red-600 font-black text-xl mb-4">
          !
        </div>
        <h2 className="text-xl font-bold text-gray-900">Access Denied</h2>
        <p className="text-sm text-gray-500 mt-2">
          You do not have the required permissions to view this screen. If you believe this is an error, please contact your administrator.
        </p>
        <Button
          type="button"
          className="mt-6 w-full justify-center"
          onClick={handleGoHome}
        >
          Return to Safety
        </Button>
      </Card>
    </div>
  );
}

export default AccessDeniedPage;
