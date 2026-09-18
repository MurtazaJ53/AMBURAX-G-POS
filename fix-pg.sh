sed -i '/listen_addresses =/d' /etc/postgresql/16/main/postgresql.conf
echo "listen_addresses = '*'" >> /etc/postgresql/16/main/postgresql.conf
pg_ctlcluster 16 main restart
ss -tulpn | grep 55432
