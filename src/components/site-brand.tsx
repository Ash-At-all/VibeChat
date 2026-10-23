import Image from "next/image";
import Link from "next/link";

export function SiteBrand() {
  return (
    <Link className="brand" href="/" aria-label="VibeChat home">
      <Image
        src="/logo.svg"
        alt="VibeChat logo"
        width={30}
        height={30}
        className="brand-logo"
        priority
      />
      <span>VibeChat</span>
    </Link>
  );
}
