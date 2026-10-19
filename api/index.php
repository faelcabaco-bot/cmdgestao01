<?php
declare(strict_types=1);
require __DIR__ . '/config.php';

ini_set('session.gc_maxlifetime', (string)(60 * 60 * 24 * 30));
session_name('cmdsess');
session_set_cookie_params([
    'lifetime' => 60 * 60 * 24 * 30, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax',
    'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
]);
session_start();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

class ApiErr extends Exception {}

function fail(string $m): never { throw new ApiErr($m); }
function reply($data): never { echo json_encode(['data' => $data, 'error' => null], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION); exit; }
function uuid(): string {
    $d = random_bytes(16);
    $d[6] = chr(ord($d[6]) & 0x0f | 0x40);
    $d[8] = chr(ord($d[8]) & 0x3f | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($d), 4));
}
function r2($n): float { return round((float)$n, 2); }

function db(): PDO {
    static $pdo = null;
    if (!$pdo) {
        $pdo = new PDO('mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4', DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => true,
        ]);
        $pdo->exec("SET time_zone = '+00:00'");
    }
    return $pdo;
}
function q(string $sql, array $p = []): PDOStatement { $s = db()->prepare($sql); $s->execute($p); return $s; }
function one(string $sql, array $p = []) { $r = q($sql, $p)->fetch(); return $r ?: null; }

// ---------- esquema (tipos das colunas) ----------
function schema(): array {
    static $s = null;
    if ($s === null) {
        $s = [];
        foreach (q("SELECT TABLE_NAME t, COLUMN_NAME c, DATA_TYPE d, COLUMN_TYPE ct FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()")->fetchAll() as $r) {
            $s[$r['t']][$r['c']] = ($r['ct'] === 'tinyint(1)') ? 'bool' : $r['d'];
        }
    }
    return $s;
}
function castRow(string $table, array $row): array {
    $cols = schema()[$table] ?? [];
    foreach ($row as $k => $v) {
        if ($v === null) continue;
        switch ($cols[$k] ?? '') {
            case 'bool': $row[$k] = (bool)(int)$v; break;
            case 'int': case 'bigint': case 'smallint': case 'tinyint': case 'mediumint': $row[$k] = (int)$v; break;
            case 'decimal': case 'float': case 'double': $row[$k] = (float)$v; break;
            case 'datetime': case 'timestamp': $row[$k] = str_replace(' ', 'T', $v) . '.000Z'; break;
            case 'json': $row[$k] = json_decode($v, true); break;
        }
    }
    return $row;
}
function dbVal(string $table, string $col, $v) {
    $t = schema()[$table][$col] ?? '';
    if (is_bool($v)) return $v ? 1 : 0;
    if (is_array($v)) return json_encode($v, JSON_UNESCAPED_UNICODE);
    if (is_string($v) && ($t === 'datetime' || $t === 'timestamp') && preg_match('/^\d{4}-\d\d-\d\dT/', $v)) {
        return gmdate('Y-m-d H:i:s', strtotime($v));
    }
    if (is_string($v) && $t === 'date' && preg_match('/^\d{4}-\d\d-\d\d/', $v)) return substr($v, 0, 10);
    return $v;
}

// ---------- sessão / permissões ----------
function me(): ?array {
    if (empty($_SESSION['uid'])) return null;
    static $c = null;
    if ($c && $c['id'] === $_SESSION['uid']) return $c;
    $u = one("SELECT u.id, u.email, u.tenant_id, t.name AS tenant_name, p.active FROM users u JOIN tenants t ON t.id = u.tenant_id LEFT JOIN profiles p ON p.id = u.id WHERE u.id = ?", [$_SESSION['uid']]);
    if (!$u || (isset($u['active']) && !(int)$u['active'])) { $_SESSION = []; return null; }
    $roles = array_column(q("SELECT role FROM user_roles WHERE user_id = ? AND tenant_id = ?", [$u['id'], $u['tenant_id']])->fetchAll(), 'role');
    $u['role'] = in_array('admin', $roles) ? 'admin' : (in_array('gerente', $roles) ? 'gerente' : 'vendedor');
    return $c = $u;
}
function needUser(): array { $u = me(); if (!$u) fail('Sessão expirada. Entre novamente.'); return $u; }
function needManager(): array { $u = needUser(); if ($u['role'] === 'vendedor') fail('Sem permissão para esta ação'); return $u; }
function needAdmin(): array { $u = needUser(); if ($u['role'] !== 'admin') fail('Somente administradores podem fazer isso'); return $u; }

// tabela => [leitura, inserir, atualizar, apagar]  (staff = qualquer usuário logado)
const PERM = [
    'brands' => ['staff', 'manager', 'manager', 'manager'],
    'categories' => ['staff', 'manager', 'manager', 'manager'],
    'suppliers' => ['staff', 'manager', 'manager', 'manager'],
    'customers' => ['staff', 'staff', 'staff', 'manager'],
    'products' => ['staff', 'manager', 'manager', 'manager'],
    'profiles' => ['staff', 'no', 'admin', 'no'],
    'user_roles' => ['staff', 'admin', 'admin', 'admin'],
    'cash_registers' => ['staff', 'staff', 'no', 'no'],
    'cash_movements' => ['staff', 'staff', 'no', 'no'],
    'sales' => ['staff', 'no', 'no', 'no'],
    'sale_items' => ['staff', 'no', 'no', 'no'],
    'sale_payments' => ['staff', 'no', 'no', 'no'],
    'customer_credit_payments' => ['staff', 'no', 'no', 'no'],
    'settings' => ['staff', 'no', 'manager', 'no'],
    'stock_batches' => ['staff', 'staff', 'manager', 'no'],
    'stock_movements' => ['staff', 'staff', 'no', 'no'],
    'audit_logs' => ['manager', 'no', 'no', 'no'],
];
function allow(string $level): void {
    if ($level === 'no') fail('Operação não permitida');
    if ($level === 'staff') needUser(); elseif ($level === 'manager') needManager(); else needAdmin();
}

function validateTenantReferences(string $table, array $values, string $tenantId): void {
    $references = [
        'products' => ['brand_id' => 'brands', 'category_id' => 'categories', 'supplier_id' => 'suppliers'],
        'stock_batches' => ['product_id' => 'products'],
        'cash_movements' => ['register_id' => 'cash_registers'],
        'user_roles' => ['user_id' => 'users'],
    ];
    foreach ($references[$table] ?? [] as $column => $target) {
        $id = $values[$column] ?? null;
        if ($id !== null && !one("SELECT id FROM `$target` WHERE tenant_id = ? AND id = ?", [$tenantId, $id])) {
            fail('Referência inválida para esta empresa');
        }
    }
}

// relação: nome => [tabela, tipo, coluna]  ('one': coluna FK nesta tabela; 'many': coluna FK na outra)
const REL = [
    'products' => ['brands' => ['brands', 'one', 'brand_id'], 'categories' => ['categories', 'one', 'category_id']],
    'sales' => [
        'sale_items' => ['sale_items', 'many', 'sale_id'], 'sale_payments' => ['sale_payments', 'many', 'sale_id'],
        'customers' => ['customers', 'one', 'customer_id'],
    ],
    'customer_credit_payments' => ['customers' => ['customers', 'one', 'customer_id']],
    'stock_batches' => ['products' => ['products', 'one', 'product_id']],
    'stock_movements' => ['products' => ['products', 'one', 'product_id']],
    'sale_items' => ['products' => ['products', 'one', 'product_id']],
];

function splitTop(string $s): array {
    $out = []; $d = 0; $cur = '';
    foreach (str_split($s) as $ch) {
        if ($ch === '(') $d++;
        if ($ch === ')') $d--;
        if ($ch === ',' && $d === 0) { $out[] = trim($cur); $cur = ''; } else $cur .= $ch;
    }
    if (trim($cur) !== '') $out[] = trim($cur);
    return $out;
}
function parseSelect(string $s): array {
    $cols = []; $rels = [];
    foreach (splitTop($s) as $part) {
        if (preg_match('/^(\w+)(?:!\w+)?\((.*)\)$/s', $part, $m)) $rels[$m[1]] = $m[2];
        else $cols[] = $part;
    }
    if (!$cols) $cols = ['*'];
    return [$cols, $rels];
}

function addFilters(string $table, array $filters, array &$where, array &$params): void {
    $cols = schema()[$table] ?? [];
    foreach ($filters as $f) {
        $col = (string)($f['col'] ?? '');
        if (!isset($cols[$col])) fail("Coluna inválida: $col");
        $v = array_key_exists('val', $f) ? $f['val'] : null;
        $op = $f['op'];
        $neg = false;
        if ($op === 'not') { $neg = true; $op = $f['sub'] ?? 'eq'; }
        $c = "`$col`";
        if ($op === 'is') { $where[] = $c . ($v === null ? ($neg ? ' IS NOT NULL' : ' IS NULL') : ($neg ? ' IS NOT ' : ' IS ') . (($v === true) ? 'TRUE' : 'FALSE')); continue; }
        if ($op === 'in') {
            if (!is_array($v) || !$v) { $where[] = $neg ? '1=1' : '1=0'; continue; }
            $where[] = "$c " . ($neg ? 'NOT ' : '') . 'IN (' . implode(',', array_fill(0, count($v), '?')) . ')';
            foreach ($v as $x) $params[] = dbVal($table, $col, $x);
            continue;
        }
        $map = ['eq' => '=', 'neq' => '<>', 'gt' => '>', 'gte' => '>=', 'lt' => '<', 'lte' => '<='];
        if (!isset($map[$op])) fail('Filtro inválido');
        $sql = $map[$op];
        if ($neg) $sql = ['=' => '<>', '<>' => '=', '>' => '<=', '>=' => '<', '<' => '>=', '<=' => '>'][$sql];
        if ($v === null) { $where[] = $c . ($sql === '=' ? ' IS NULL' : ' IS NOT NULL'); continue; }
        $where[] = "$c $sql ?";
        $params[] = dbVal($table, $col, $v);
    }
}

function embed(string $table, array $rows, array $rels): array {
    foreach ($rels as $name => $inner) {
        $def = REL[$table][$name] ?? null;
        if (!$def) fail("Relação inválida: $name");
        [$t2, $kind, $fk] = $def;
        [$cols2, $rels2] = parseSelect($inner);
        if ($kind === 'one') {
            $ids = array_values(array_unique(array_filter(array_column($rows, $fk))));
            $map = [];
            if ($ids) {
                $res = q("SELECT * FROM `$t2` WHERE tenant_id = ? AND id IN (" . implode(',', array_fill(0, count($ids), '?')) . ")", array_merge([needUser()['tenant_id']], $ids))->fetchAll();
                $res = array_map(fn($r) => castRow($t2, $r), $res);
                $res = embed($t2, $res, $rels2);
                foreach ($res as $r) $map[$r['id']] = project($r, $cols2);
            }
            foreach ($rows as &$r) $r[$name] = $map[$r[$fk] ?? ''] ?? null;
            unset($r);
        } else {
            $ids = array_column($rows, 'id');
            $map = [];
            if ($ids) {
                $order = isset(schema()[$t2]['created_at']) ? ' ORDER BY created_at' : '';
                $res = q("SELECT * FROM `$t2` WHERE tenant_id = ? AND `$fk` IN (" . implode(',', array_fill(0, count($ids), '?')) . ")$order", array_merge([needUser()['tenant_id']], $ids))->fetchAll();
                $res = array_map(fn($r) => castRow($t2, $r), $res);
                $res = embed($t2, $res, $rels2);
                foreach ($res as $r) $map[$r[$fk]][] = project($r, $cols2);
            }
            foreach ($rows as &$r) $r[$name] = $map[$r['id']] ?? [];
            unset($r);
        }
    }
    return $rows;
}
function project(array $r, array $cols): array {
    if (in_array('*', $cols, true)) return $r;
    $o = [];
    foreach ($cols as $c) if (array_key_exists($c, $r)) $o[$c] = $r[$c];
    return $o;
}

// ---------- consulta genérica (select / insert / update / delete) ----------
function doQuery(array $p): array|null {
    $table = (string)($p['table'] ?? '');
    if (!isset(PERM[$table]) || !isset(schema()[$table])) fail('Tabela inválida');
    $op = $p['op'] ?? 'select';
    $idx = ['select' => 0, 'insert' => 1, 'update' => 2, 'delete' => 3][$op] ?? fail('Operação inválida');
    allow(PERM[$table][$idx]);
    $user = needUser();
    $filters = $p['filters'] ?? [];
    $cols = schema()[$table];

    if ($op === 'insert') {
        $vals = $p['values'] ?? [];
        if ($vals && array_keys($vals) !== range(0, count($vals) - 1)) $vals = [$vals];
        $out = [];
        db()->beginTransaction();
        try {
            foreach ($vals as $row) { $out[] = insertRow($table, $row, $user); }
            db()->commit();
        } catch (Throwable $e) { if (db()->inTransaction()) db()->rollBack(); throw $e; }
        return array_map(fn($r) => castRow($table, $r), $out);
    }

    $where = []; $params = [];
    addFilters($table, $filters, $where, $params);
    $where[] = '`tenant_id` = ?'; $params[] = $user['tenant_id'];
    if ($user['role'] === 'vendedor' && in_array($table, ['cash_registers', 'sales', 'cash_movements', 'customer_credit_payments'], true)) {
        $where[] = '`user_id` = ?'; $params[] = $user['id'];
    }
    if ($table === 'profiles' && $op === 'update' && $user['role'] !== 'admin') fail('Sem permissão');

    if ($op === 'update') {
        if (!$where) fail('Atualização sem filtro');
        $set = []; $sp = [];
        foreach (($p['values'] ?? []) as $k => $v) {
            if (!isset($cols[$k]) || in_array($k, ['id', 'tenant_id'], true)) continue;
            $set[] = "`$k` = ?"; $sp[] = dbVal($table, $k, $v);
        }
        if (!$set) return [];
        validateTenantReferences($table, $p['values'] ?? [], $user['tenant_id']);
        q("UPDATE `$table` SET " . implode(', ', $set) . " WHERE " . implode(' AND ', $where), array_merge($sp, $params));
        return [];
    }
    if ($op === 'delete') {
        if (!$where) fail('Exclusão sem filtro');
        if ($table === 'user_roles') { /* admin apenas (PERM) */ }
        q("DELETE FROM `$table` WHERE " . implode(' AND ', $where), $params);
        return [];
    }

    // select
    $sql = "SELECT * FROM `$table`" . ($where ? ' WHERE ' . implode(' AND ', $where) : '');
    $ord = [];
    foreach (($p['order'] ?? []) as $o) {
        if (!isset($cols[$o['col'] ?? ''])) fail('Ordenação inválida');
        $ord[] = '`' . $o['col'] . '` ' . (!empty($o['asc']) ? 'ASC' : 'DESC');
    }
    if ($ord) $sql .= ' ORDER BY ' . implode(', ', $ord);
    $single = $p['single'] ?? null;
    if (!empty($p['limit'])) $sql .= ' LIMIT ' . (int)$p['limit'];
    elseif ($single) $sql .= ' LIMIT 2';
    $rows = array_map(fn($r) => castRow($table, $r), q($sql, $params)->fetchAll());
    [$sc, $sr] = parseSelect((string)($p['select'] ?? '*'));
    $rows = embed($table, $rows, $sr);
    $rows = array_map(fn($r) => project($r, array_merge($sc, array_keys($sr))), $rows);
    if ($single === 'single') {
        if (count($rows) !== 1) fail('Registro não encontrado');
        return $rows[0];
    }
    if ($single === 'maybe') {
        if (count($rows) > 1) fail('Mais de um registro encontrado');
        return $rows[0] ?? null;
    }
    return $rows;
}

function insertRow(string $table, array $row, array $user): array {
    $cols = schema()[$table];
    if (isset($cols['tenant_id'])) $row['tenant_id'] = $user['tenant_id'];
    validateTenantReferences($table, $row, $user['tenant_id']);
    // regras por tabela
    if ($table === 'cash_registers') {
        if (one("SELECT id FROM cash_registers WHERE tenant_id = ? AND user_id = ? AND status = 'aberto'", [$user['tenant_id'], $user['id']])) fail('Você já tem um caixa aberto');
        $row = ['tenant_id' => $user['tenant_id'], 'user_id' => $user['id'], 'status' => 'aberto', 'opening_amount' => max(0, r2($row['opening_amount'] ?? 0))];
    }
    if ($table === 'cash_movements') {
        $reg = one("SELECT * FROM cash_registers WHERE tenant_id = ? AND id = ? AND status = 'aberto'", [$user['tenant_id'], $row['register_id'] ?? '']);
        if (!$reg || ($reg['user_id'] !== $user['id'] && $user['role'] === 'vendedor')) fail('Caixa não encontrado ou fechado');
        if (!in_array($row['type'] ?? '', ['sangria', 'suprimento'], true)) fail('Tipo inválido');
        if (r2($row['amount'] ?? 0) <= 0) fail('Valor inválido');
        $row['user_id'] = $user['id'];
    }
    if ($table === 'stock_movements') {
        $row['user_id'] = $user['id'];
        unset($row['sale_id']);
        if (in_array($row['type'] ?? '', ['venda', 'estorno'], true)) fail('Tipo inválido');
        if (!one("SELECT id FROM products WHERE tenant_id = ? AND id = ?", [$user['tenant_id'], $row['product_id'] ?? ''])) fail('Produto não encontrado');
        if (!(float)($row['quantity'] ?? 0)) fail('Quantidade inválida');
    }
    if ($table === 'user_roles' && !in_array($row['role'] ?? '', ['admin', 'gerente', 'vendedor'], true)) fail('Perfil inválido');

    $data = [];
    foreach ($row as $k => $v) if (isset($cols[$k]) && !in_array($k, ['number'], true)) $data[$k] = dbVal($table, $k, $v);
    if (isset($cols['id']) && empty($data['id'])) $data['id'] = uuid();
    $names = array_keys($data);
    q("INSERT INTO `$table` (" . implode(',', array_map(fn($n) => "`$n`", $names)) . ") VALUES (" . implode(',', array_fill(0, count($names), '?')) . ")", array_values($data));

    if ($table === 'stock_movements') {
        q("UPDATE products SET stock = stock + ? WHERE tenant_id = ? AND id = ?", [$data['quantity'], $user['tenant_id'], $data['product_id']]);
        if (($data['type'] ?? '') === 'entrada' && !empty($data['unit_cost'])) q("UPDATE products SET cost_price = ? WHERE tenant_id = ? AND id = ?", [$data['unit_cost'], $user['tenant_id'], $data['product_id']]);
    }
    return one("SELECT * FROM `$table` WHERE tenant_id = ? AND id = ?", [$user['tenant_id'], $data['id']]) ?? $data;
}

// ---------- regras de negócio (funções que existiam no banco) ----------
function finalizeSale(array $pl, array $user): string {
    $items = $pl['items'] ?? []; $pays = $pl['payments'] ?? [];
    if (!$items) fail('Carrinho vazio');
    if (!$pays) fail('Informe o pagamento');
    db()->beginTransaction();
    try {
        $reg = one("SELECT * FROM cash_registers WHERE tenant_id = ? AND user_id = ? AND status = 'aberto' FOR UPDATE", [$user['tenant_id'], $user['id']]);
        if (!$reg) fail('Abra o caixa antes de vender');
        $st = one("SELECT * FROM settings WHERE tenant_id = ? AND id = 1", [$user['tenant_id']]) ?? ['block_no_stock' => 1, 'points_per_real' => 1];
        $subtotal = 0.0; $lines = [];
        foreach ($items as $it) {
            $p = one("SELECT * FROM products WHERE tenant_id = ? AND id = ? FOR UPDATE", [$user['tenant_id'], $it['product_id'] ?? '']);
            if (!$p) fail('Produto não encontrado');
            $qty = (float)($it['quantity'] ?? 0);
            if ($qty <= 0) fail('Quantidade inválida');
            if ((int)$st['block_no_stock'] && (float)$p['stock'] < $qty) fail('Estoque insuficiente: ' . $p['name'] . ($p['variant'] ? ' ' . $p['variant'] : ''));
            $price = r2($it['unit_price'] ?? $p['sale_price']);
            $disc = max(0, r2($it['discount'] ?? 0));
            $tot = r2($qty * $price - $disc);
            $subtotal += $tot;
            $lines[] = [$p, $qty, $price, $disc, $tot];
        }
        $subtotal = r2($subtotal);
        $discount = min($subtotal, max(0, r2($pl['discount'] ?? 0)));
        $total = r2($subtotal - $discount);
        $paid = 0.0; $cash = 0.0;
        foreach ($pays as $pm) {
            if (!in_array($pm['method'] ?? '', ['dinheiro', 'pix', 'debito', 'credito', 'fiado'], true)) fail('Forma de pagamento inválida');
            $paid += r2($pm['amount'] ?? 0);
            if ($pm['method'] === 'dinheiro') $cash += r2($pm['amount']);
            if ($pm['method'] === 'fiado' && empty($pl['customer_id'])) fail('Venda fiado exige cliente');
        }
        $paid = r2($paid);
        if ($paid + 0.001 < $total) fail('Pagamento menor que o total');
        $change = r2(min(max(0, $paid - $total), $cash));
        if ($paid - $total > $cash + 0.001) fail('Troco só pode sair do dinheiro');
        $cust = !empty($pl['customer_id']) ? $pl['customer_id'] : null;
        if ($cust && !one("SELECT id FROM customers WHERE tenant_id = ? AND id = ?", [$user['tenant_id'], $cust])) fail('Cliente não encontrado');

        $sid = uuid();
        q("INSERT INTO sales (id, tenant_id, register_id, user_id, customer_id, status, subtotal, discount, total, change_amount) VALUES (?,?,?,?,?,?,?,?,?,?)",
            [$sid, $user['tenant_id'], $reg['id'], $user['id'], $cust, 'concluida', $subtotal, $discount, $total, $change]);
        foreach ($lines as [$p, $qty, $price, $disc, $tot]) {
            q("INSERT INTO sale_items (id, tenant_id, sale_id, product_id, name, quantity, unit_price, unit_cost, discount, total) VALUES (?,?,?,?,?,?,?,?,?,?)",
                [uuid(), $user['tenant_id'], $sid, $p['id'], $p['name'] . ($p['variant'] ? ' ' . $p['variant'] : ''), $qty, $price, $p['cost_price'], $disc, $tot]);
            q("UPDATE products SET stock = stock - ? WHERE tenant_id = ? AND id = ?", [$qty, $user['tenant_id'], $p['id']]);
            q("INSERT INTO stock_movements (id, tenant_id, product_id, type, quantity, reason, sale_id, user_id) VALUES (?,?,?,?,?,?,?,?)",
                [uuid(), $user['tenant_id'], $p['id'], 'venda', -$qty, 'Venda', $sid, $user['id']]);
            // baixa nos lotes (vence primeiro, sai primeiro)
            $left = $qty;
            foreach (q("SELECT id, quantity FROM stock_batches WHERE tenant_id = ? AND product_id = ? AND quantity > 0 ORDER BY (expires_at IS NULL), expires_at, created_at FOR UPDATE", [$user['tenant_id'], $p['id']])->fetchAll() as $b) {
                if ($left <= 0) break;
                $take = min($left, (float)$b['quantity']);
                q("UPDATE stock_batches SET quantity = quantity - ? WHERE tenant_id = ? AND id = ?", [$take, $user['tenant_id'], $b['id']]);
                $left -= $take;
            }
        }
        foreach ($pays as $pm) {
            q("INSERT INTO sale_payments (id, tenant_id, sale_id, method, amount, installments) VALUES (?,?,?,?,?,?)",
                [uuid(), $user['tenant_id'], $sid, $pm['method'], r2($pm['amount']), max(1, (int)($pm['installments'] ?? 1))]);
        }
        if ($cust) q("UPDATE customers SET points = points + ? WHERE tenant_id = ? AND id = ?", [(int)floor($total * (float)$st['points_per_real']), $user['tenant_id'], $cust]);
        db()->commit();
        return $sid;
    } catch (Throwable $e) { if (db()->inTransaction()) db()->rollBack(); throw $e; }
}

function cancelSale(string $id, string $reason, array $user): void {
    db()->beginTransaction();
    try {
        $s = one("SELECT * FROM sales WHERE tenant_id = ? AND id = ? FOR UPDATE", [$user['tenant_id'], $id]);
        if (!$s) fail('Venda não encontrada');
        if ($s['status'] !== 'concluida') fail('Venda já cancelada');
        q("UPDATE sales SET status='cancelada', cancel_reason=?, canceled_at=UTC_TIMESTAMP(), canceled_by=? WHERE tenant_id = ? AND id=?", [$reason ?: null, $user['id'], $user['tenant_id'], $id]);
        foreach (q("SELECT * FROM sale_items WHERE tenant_id = ? AND sale_id = ?", [$user['tenant_id'], $id])->fetchAll() as $it) {
            q("UPDATE products SET stock = stock + ? WHERE tenant_id = ? AND id = ?", [$it['quantity'], $user['tenant_id'], $it['product_id']]);
            q("INSERT INTO stock_movements (id, tenant_id, product_id, type, quantity, reason, sale_id, user_id) VALUES (?,?,?,?,?,?,?,?)",
                [uuid(), $user['tenant_id'], $it['product_id'], 'estorno', $it['quantity'], 'Cancelamento da venda #' . $s['number'], $id, $user['id']]);
        }
        if ($s['customer_id']) {
            $ppr = (float)(one("SELECT points_per_real FROM settings WHERE tenant_id = ? AND id = 1", [$user['tenant_id']])['points_per_real'] ?? 1);
            q("UPDATE customers SET points = GREATEST(0, points - ?) WHERE tenant_id = ? AND id = ?", [(int)floor((float)$s['total'] * $ppr), $user['tenant_id'], $s['customer_id']]);
        }
        db()->commit();
    } catch (Throwable $e) { if (db()->inTransaction()) db()->rollBack(); throw $e; }
}

function closeRegister(string $id, float $counted, string $notes, array $user): float {
    $reg = one("SELECT * FROM cash_registers WHERE tenant_id = ? AND id = ? AND status = 'aberto'", [$user['tenant_id'], $id]);
    if (!$reg) fail('Caixa não encontrado ou já fechado');
    if ($reg['user_id'] !== $user['id'] && $user['role'] === 'vendedor') fail('Sem permissão');
    $cash = (float)(one("SELECT COALESCE(SUM(p.amount),0) v FROM sale_payments p JOIN sales s ON s.id = p.sale_id AND s.tenant_id = p.tenant_id WHERE s.tenant_id = ? AND s.register_id = ? AND s.status = 'concluida' AND p.method = 'dinheiro'", [$user['tenant_id'], $id])['v']);
    $creditCash = (float)(one("SELECT COALESCE(SUM(amount),0) v FROM customer_credit_payments WHERE tenant_id = ? AND register_id = ? AND method = 'dinheiro'", [$user['tenant_id'], $id])['v']);
    $chg = (float)(one("SELECT COALESCE(SUM(change_amount),0) v FROM sales WHERE tenant_id = ? AND register_id = ? AND status = 'concluida'", [$user['tenant_id'], $id])['v']);
    $sup = (float)(one("SELECT COALESCE(SUM(amount),0) v FROM cash_movements WHERE tenant_id = ? AND register_id = ? AND type = 'suprimento'", [$user['tenant_id'], $id])['v']);
    $sang = (float)(one("SELECT COALESCE(SUM(amount),0) v FROM cash_movements WHERE tenant_id = ? AND register_id = ? AND type = 'sangria'", [$user['tenant_id'], $id])['v']);
    $expected = r2((float)$reg['opening_amount'] + $cash + $creditCash - $chg + $sup - $sang);
    q("UPDATE cash_registers SET status='fechado', closed_at=UTC_TIMESTAMP(), counted_amount=?, expected_amount=?, notes=? WHERE tenant_id = ? AND id=?", [r2($counted), $expected, $notes ?: null, $user['tenant_id'], $id]);
    return r2($counted - $expected);
}

function receiveCreditPayment(string $saleId, float $amount, string $method, string $notes, array $user): string {
    $amount = r2($amount);
    if ($amount <= 0) fail('Informe um valor maior que zero');
    if (!in_array($method, ['dinheiro', 'pix', 'debito', 'credito'], true)) fail('Forma de recebimento inválida');
    db()->beginTransaction();
    try {
        $register = one("SELECT * FROM cash_registers WHERE tenant_id = ? AND user_id = ? AND status = 'aberto' FOR UPDATE", [$user['tenant_id'], $user['id']]);
        if (!$register) fail('Abra o caixa antes de receber um pagamento');
        $sale = one("SELECT * FROM sales WHERE tenant_id = ? AND id = ? FOR UPDATE", [$user['tenant_id'], $saleId]);
        if (!$sale || $sale['status'] !== 'concluida') fail('Venda não encontrada ou cancelada');
        if (empty($sale['customer_id'])) fail('Venda sem cliente vinculado');
        $debt = (float)(one("SELECT COALESCE(SUM(amount),0) v FROM sale_payments WHERE tenant_id = ? AND sale_id = ? AND method = 'fiado'", [$user['tenant_id'], $saleId])['v']);
        $received = (float)(one("SELECT COALESCE(SUM(amount),0) v FROM customer_credit_payments WHERE tenant_id = ? AND sale_id = ?", [$user['tenant_id'], $saleId])['v']);
        $balance = r2($debt - $received);
        if ($balance <= 0) fail('Esta venda não tem saldo em aberto');
        if ($amount - $balance > 0.001) fail('O valor excede o saldo devedor de R$ ' . number_format($balance, 2, ',', '.'));
        $id = uuid();
        q("INSERT INTO customer_credit_payments (id, tenant_id, sale_id, customer_id, register_id, user_id, amount, method, notes) VALUES (?,?,?,?,?,?,?,?,?)",
            [$id, $user['tenant_id'], $saleId, $sale['customer_id'], $register['id'], $user['id'], r2($amount), $method, trim($notes) ?: null]);
        db()->commit();
        return $id;
    } catch (Throwable $e) { if (db()->inTransaction()) db()->rollBack(); throw $e; }
}

function rpc(string $fn, array $a): mixed {
    switch ($fn) {
        case 'finalize_sale': return finalizeSale($a['payload'] ?? [], needUser());
        case 'receive_credit_payment': return receiveCreditPayment((string)($a['_sale_id'] ?? ''), (float)($a['_amount'] ?? 0), (string)($a['_method'] ?? ''), (string)($a['_notes'] ?? ''), needUser());
        case 'close_register': return closeRegister((string)($a['_register_id'] ?? ''), (float)($a['_counted'] ?? 0), (string)($a['_notes'] ?? ''), needUser());
        case 'has_cancel_password': $u = needUser(); return (bool)one("SELECT id FROM cancel_authorization WHERE tenant_id = ? AND id = 1", [$u['tenant_id']]);
        case 'set_cancel_password':
            $u = needManager(); $pw = (string)($a['_password'] ?? '');
            if (strlen(trim($pw)) < 4) fail('A senha precisa ter pelo menos 4 caracteres');
            db()->beginTransaction();
            try {
                $current = one("SELECT password_hash FROM cancel_authorization WHERE tenant_id = ? AND id = 1 FOR UPDATE", [$u['tenant_id']]);
                if ($current && !password_verify((string)($a['_current_password'] ?? ''), $current['password_hash'])) fail('Senha atual incorreta');
                q("INSERT INTO cancel_authorization (tenant_id, id, password_hash, failed_attempts, locked_until, updated_by, updated_at) VALUES (?,1,?,0,NULL,?,UTC_TIMESTAMP())
                   ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), failed_attempts=0, locked_until=NULL, updated_by=VALUES(updated_by), updated_at=UTC_TIMESTAMP()",
                    [$u['tenant_id'], password_hash($pw, PASSWORD_DEFAULT), $u['id']]);
                db()->commit();
            } catch (Throwable $e) { if (db()->inTransaction()) db()->rollBack(); throw $e; }
            return null;
        case 'cancel_sale_authorized':
            $u = needManager();
            $rec = one("SELECT * FROM cancel_authorization WHERE tenant_id = ? AND id = 1", [$u['tenant_id']]);
            if (!$rec) return 'sem_senha';
            if ($rec['locked_until'] && strtotime($rec['locked_until'] . ' UTC') > time()) return 'bloqueado';
            if (!password_verify((string)($a['_password'] ?? ''), $rec['password_hash'])) {
                if ((int)$rec['failed_attempts'] + 1 >= 5) {
                    q("UPDATE cancel_authorization SET failed_attempts = 0, locked_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE) WHERE tenant_id = ? AND id = 1", [$u['tenant_id']]);
                    return 'bloqueado';
                }
                q("UPDATE cancel_authorization SET failed_attempts = failed_attempts + 1 WHERE tenant_id = ? AND id = 1", [$u['tenant_id']]);
                return 'senha_incorreta';
            }
            q("UPDATE cancel_authorization SET failed_attempts = 0, locked_until = NULL WHERE tenant_id = ? AND id = 1", [$u['tenant_id']]);
            cancelSale((string)($a['_sale_id'] ?? ''), trim((string)($a['_reason'] ?? '')), $u);
            return 'ok';
    }
    fail('Função inválida');
}

// ---------- autenticação ----------
function auth(string $act, array $b): mixed {
    switch ($act) {
        case 'me':
            $u = me();
            return ['user' => $u ? ['id' => $u['id'], 'email' => $u['email'], 'tenant_id' => $u['tenant_id'], 'tenant_name' => $u['tenant_name']] : null];
        case 'login':
            $email = strtolower(trim((string)($b['email'] ?? '')));
            $u = one("SELECT id, tenant_id, password_hash FROM users WHERE email = ?", [$email]);
            if (!$u || !password_verify((string)($b['password'] ?? ''), $u['password_hash'])) { usleep(400000); fail('Invalid login credentials'); }
            $pf = one("SELECT active FROM profiles WHERE tenant_id = ? AND id = ?", [$u['tenant_id'], $u['id']]);
            if ($pf && !(int)$pf['active']) fail('Usuário desativado');
            session_regenerate_id(true);
            $_SESSION['uid'] = $u['id'];
            return ['user' => ['id' => $u['id'], 'email' => $email]];
        case 'signup':
            $email = strtolower(trim((string)($b['email'] ?? '')));
            $pw = (string)($b['password'] ?? '');
            $name = trim((string)($b['full_name'] ?? ''));
            $tenantName = trim((string)($b['company_name'] ?? ''));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('E-mail inválido');
            if (strlen($pw) < 6) fail('A senha precisa ter pelo menos 6 caracteres');
            $tenantLength = preg_match_all('/./us', $tenantName);
            if ($tenantName === '' || $tenantLength === false || $tenantLength > 190) fail('Informe o nome da loja (até 190 caracteres)');
            if (one("SELECT id FROM users WHERE email = ?", [$email])) fail('Este e-mail já está cadastrado');
            $id = uuid();
            db()->beginTransaction();
            try {
                $tenantId = uuid();
                q("INSERT INTO tenants (id, name) VALUES (?,?)", [$tenantId, $tenantName]);
                q("INSERT INTO settings (tenant_id, id, store_name, receipt_footer) VALUES (?,1,?,'Obrigado pela preferência!')", [$tenantId, $tenantName]);
                q("INSERT INTO users (id, tenant_id, email, password_hash) VALUES (?,?,?,?)", [$id, $tenantId, $email, password_hash($pw, PASSWORD_DEFAULT)]);
                q("INSERT INTO profiles (id, tenant_id, full_name, email, active) VALUES (?,?,?,?,1)", [$id, $tenantId, $name !== '' ? $name : explode('@', $email)[0], $email]);
                q("INSERT INTO user_roles (id, tenant_id, user_id, role) VALUES (?,?,?,'admin')", [uuid(), $tenantId, $id]);
                db()->commit();
            } catch (Throwable $e) { if (db()->inTransaction()) db()->rollBack(); throw $e; }
            return ['user' => ['id' => $id, 'email' => $email]];
        case 'create_user':
            $admin = needAdmin();
            $email = strtolower(trim((string)($b['email'] ?? '')));
            $pw = (string)($b['password'] ?? '');
            $name = trim((string)($b['full_name'] ?? ''));
            $role = (string)($b['role'] ?? 'vendedor');
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail('E-mail inválido');
            if (strlen($pw) < 8) fail('A senha inicial precisa ter pelo menos 8 caracteres');
            if ($name === '') fail('Informe o nome do funcionário');
            if (!in_array($role, ['gerente', 'vendedor'], true)) fail('Perfil inválido para novo funcionário');
            db()->beginTransaction();
            try {
                $id = uuid();
                q("INSERT INTO users (id, tenant_id, email, password_hash) VALUES (?,?,?,?)", [$id, $admin['tenant_id'], $email, password_hash($pw, PASSWORD_DEFAULT)]);
                q("INSERT INTO profiles (id, tenant_id, full_name, email, active) VALUES (?,?,?,?,1)", [$id, $admin['tenant_id'], $name, $email]);
                q("INSERT INTO user_roles (id, tenant_id, user_id, role) VALUES (?,?,?,?)", [uuid(), $admin['tenant_id'], $id, $role]);
                db()->commit();
            } catch (Throwable $e) { if (db()->inTransaction()) db()->rollBack(); throw $e; }
            return ['user' => ['id' => $id, 'email' => $email]];
        case 'logout':
            $_SESSION = [];
            session_destroy();
            return null;
        case 'reset_request':
            $email = strtolower(trim((string)($b['email'] ?? '')));
            $u = one("SELECT id FROM users WHERE email = ?", [$email]);
            if ($u) {
                $tok = bin2hex(random_bytes(32));
                q("DELETE FROM password_resets WHERE user_id = ? OR expires_at < UTC_TIMESTAMP()", [$u['id']]);
                q("INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR))", [hash('sha256', $tok), $u['id']]);
                $link = rtrim(APP_URL, '/') . '/reset-password?token=' . $tok;
                @mail($email, '=?UTF-8?B?' . base64_encode('Redefinir senha - CMD Gestão') . '?=',
                    "Para criar uma nova senha acesse o link abaixo (válido por 1 hora):\r\n\r\n$link\r\n\r\nSe não foi você, ignore este e-mail.",
                    "From: " . MAIL_FROM . "\r\nContent-Type: text/plain; charset=UTF-8");
            }
            return true;
        case 'update_password':
            $pw = (string)($b['password'] ?? '');
            if (strlen($pw) < 6) fail('A senha precisa ter pelo menos 6 caracteres');
            $uid = null;
            if (!empty($b['token'])) {
                $r = one("SELECT user_id FROM password_resets WHERE token_hash = ? AND expires_at > UTC_TIMESTAMP()", [hash('sha256', (string)$b['token'])]);
                if (!$r) fail('Link inválido ou expirado. Peça um novo.');
                $uid = $r['user_id'];
                q("DELETE FROM password_resets WHERE user_id = ?", [$uid]);
            } else $uid = needUser()['id'];
            q("UPDATE users SET password_hash = ? WHERE id = ?", [password_hash($pw, PASSWORD_DEFAULT), $uid]);
            session_regenerate_id(true);
            $_SESSION['uid'] = $uid;
            return true;
    }
    fail('Rota inválida');
}

// ---------- entrada ----------
try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail('Método inválido');
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin && parse_url($origin, PHP_URL_HOST) !== ($_SERVER['HTTP_HOST'] ?? '') && !str_starts_with($_SERVER['HTTP_HOST'] ?? '', parse_url($origin, PHP_URL_HOST) . ':')) fail('Origem não permitida');
    $body = json_decode(file_get_contents('php://input') ?: '{}', true) ?: [];
    $route = (string)($_GET['r'] ?? '');
    if ($route === 'query') reply(doQuery($body));
    if ($route === 'rpc') reply(rpc((string)($body['fn'] ?? ''), (array)($body['args'] ?? [])));
    if (str_starts_with($route, 'auth/')) reply(auth(substr($route, 5), $body));
    fail('Rota inválida');
} catch (ApiErr $e) {
    echo json_encode(['data' => null, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE); exit;
} catch (Throwable $e) {
    http_response_code(200);
    echo json_encode(['data' => null, 'error' => DEBUG ? $e->getMessage() : 'Erro no servidor. Verifique api/config.php e se o banco.sql foi importado.'], JSON_UNESCAPED_UNICODE); exit;
}
