import { Heading, Link, Text } from "@/components";

export default function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
      <Heading level={1} size="display">
        This gift, exist it does not.
      </Heading>
      <Text>Searched everywhere, you have. Found it here, you have not.</Text>
      <Link href="/">Return home, you should.</Link>
    </div>
  );
}
