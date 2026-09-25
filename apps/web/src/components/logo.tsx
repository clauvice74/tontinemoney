import Link from 'next/link';

export function Logo({ href = '/' }: { href?: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-md font-semibold tracking-tight text-foreground"
    >
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground"
      >
        TM
      </span>
      <span>
        Tontine<span className="text-primary">Money</span>
      </span>
    </Link>
  );
}
