cd /Volumes/Today
python3 -m http.server 666

http://localhost:666/ascend-portal

http://192.168.1.129:666/ascend/auth.html?token=test

cd "/Volumes/Today/ascend-portal"
git add .
git commit -m "whatever"
git push

cd "/Volumes/Today/ascend-portal"
./publish.sh


const jobId =
  new URLSearchParams(location.search).get("jobid") ||
  new URLSearchParams(location.search).get("jobId");

console.log("jobId from URL:", jobId);

fetch(window.COPYDESK_API_BASE, {
  method: "POST",
  headers: { "Content-Type": "text/plain;charset=utf-8" },
  body: JSON.stringify({ action: "getJob", jobId })
})
  .then(r => r.json())
  .then(console.log)
  .catch(console.error);