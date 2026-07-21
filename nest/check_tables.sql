SELECT table_name, table_rows, ROUND(data_length/1048576,1) AS data_mb, ROUND(index_length/1048576,1) AS index_mb
FROM information_schema.tables WHERE table_schema='tradingcs'
ORDER BY data_length DESC LIMIT 15;
