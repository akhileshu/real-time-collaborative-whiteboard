export function healthResponse(pathname: string): Response {
  if (pathname === "/health") {
    return new Response("ok", { status: 200 });
  }

  return new Response("not found", { status: 404 });
}
