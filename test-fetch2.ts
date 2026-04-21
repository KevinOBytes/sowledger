async function main() {
  const urls = [
    "http://127.0.0.1:3000/projects",
    "http://127.0.0.1:3000/settings/tags",
    "http://127.0.0.1:3000/clients"
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { cookie: "billabled_session=test" } }); // Send a dummy cookie to force SSR to attempt a session parse, though we will get standard error
      console.log(`\n\n--- ${url} ---`);
      console.log("Status:", res.status);
      const text = await res.text();
      // Print first 500 chars limit
      console.log("Body snippet:", text.substring(0, 1000));
      // if it's a 500, next.js outputs the error trace inside the body sometimes
    } catch (e) {
      console.error(url, e);
    }
  }
}
main();
