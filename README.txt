cd "/Volumes/Today/ascend-portal"
python3 -m http.server 666
http://localhost:666/ascend-portal

http://192.168.1.129:666/ascend/auth.html?token=test

git add .
git commit -m "whatever"
git push

cd "/Volumes/Today/ascend-portal"
./publish.sh


await window.__copydeskForceClose()