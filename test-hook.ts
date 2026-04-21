import { spawn } from 'child_process';
import http from 'http';

const startServerAndFetch = async () => {
  console.log("Starting dev server...");
  const devProcess = spawn('npm', ['run', 'dev']);
  
  devProcess.stdout.on('data', (data) => console.log(`[SERVER]: ${data.toString().trim()}`));
  devProcess.stderr.on('data', (data) => console.error(`[SERVER LOG]: ${data.toString().trim()}`));
  
  // Wait for server to be ready
  await new Promise((resolve) => setTimeout(resolve, 8000));
  
  console.log("Fetching test route...");
  http.get('http://localhost:3000/api/test/login?plan=free', (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
    
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      console.log(`BODY (first 500 chars):\n${data.substring(0, 500)}`);
      devProcess.kill();
      process.exit(0);
    });
  }).on('error', (err) => {
    console.error("HTTP Error: ", err);
    devProcess.kill();
    process.exit(1);
  });
};

startServerAndFetch();
