$filePath = "c:\Users\USUARIO\Downloads\tienda\src\components\ClientOrdersView.jsx"
$content = Get-Content $filePath -Raw
$old = '<option value="pedido_PENDIENTE">📂 PRÓXIMO PEDIDO (SIN FECHA)</option>\s+</optgroup>'
$new = '<option value="pedido_PENDIENTE">📂 PRÓXIMO PEDIDO (SIN FECHA)</option>`r`n                                                                             <option value="pedido_ESPANA">🇪🇸 IMPORTACIÓN ESPAÑA</option>`r`n                                                                         </optgroup>'
$content = $content -replace $old, $new
$content | Set-Content $filePath -NoNewline
