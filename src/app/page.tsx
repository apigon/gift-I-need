import { Heading, Text } from "@/components";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
      <Heading level={1} size="display">
        Gift I Need
      </Heading>
      <Text>Share one link, get gifts you actually want.</Text>
    </main>
  );
}
