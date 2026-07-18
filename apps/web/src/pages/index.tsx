import Head from "next/head";

export default function Home() {
  return (
    <>
      <Head>
        <title>Whiteboard</title>
        <meta
          name="description"
          content="Real-time collaborative whiteboard"
        />
      </Head>
      <main className="flex min-h-screen items-center justify-center p-8">
        <section className="w-full max-w-3xl rounded-lg border bg-card p-8 shadow-sm">
          <p className="text-sm text-muted-foreground">Workspace ready</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            Real-time collaborative whiteboard
          </h1>
          <p className="mt-4 text-muted-foreground">
            The canvas and collaboration slices will be added here.
          </p>
        </section>
      </main>
    </>
  );
}
