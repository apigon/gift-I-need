export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-canvas font-sans">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-surface sm:items-start">
        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
          <p className="text-title text-accent font-bold">
            Welcome to Gift I Need!
          </p>
        </div>
      </main>
    </div>
  );
}
