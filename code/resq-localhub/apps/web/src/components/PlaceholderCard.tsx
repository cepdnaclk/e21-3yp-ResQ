export default function PlaceholderCard({ title }: { title: string }) {
  return (
    <div style={{ border: '1px solid #eee', borderRadius: 6, padding: '1rem', marginBottom: 16, background: '#fafafa' }}>
      <h3 style={{ margin: 0 }}>{title}</h3>
      <div style={{ color: '#888', fontSize: 14 }}>Placeholder content</div>
    </div>
  );
}