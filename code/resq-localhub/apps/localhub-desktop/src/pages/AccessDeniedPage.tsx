export default function AccessDeniedPage() {
  return (
    <section style={{ display: "grid", gap: "12px", padding: "24px" }}>
      <div>
        <h2 style={{ margin: "0 0 6px 0", fontSize: "1.5rem", fontWeight: 600 }}>Access Denied</h2>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.95rem" }}>
          Your account does not have permission to open this page.
        </p>
      </div>
      <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.9rem" }}>
        If you think this is wrong, sign in with an ADMIN or INSTRUCTOR account.
      </p>
    </section>
  );
}
