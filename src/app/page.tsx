import { Heading, Text } from "@/components";
import { createClient } from "@/utils/supabase/server";

import { CreateEventForm } from "./components";

export default async function Home() {
  // getClaims(), not getUser(): this only needs a signed-in/signed-out
  // boolean, and the root layout's AuthStatus already pays one getUser()
  // round trip per request — a second one here would double that cost.
  // getClaims() verifies the session JWT locally against the (cached)
  // project JWKS instead.
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
        <Heading level={1} size="display">
          Gift I Need
        </Heading>
        <Text>Share one link, get gifts you actually want.</Text>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div>
        <Heading level={1}>Create an event</Heading>
        <Text tone="muted">
          Name it, pick a date, and start adding gift ideas.
        </Text>
      </div>
      <CreateEventForm />
    </main>
  );
}
