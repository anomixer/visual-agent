Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Drawing.Common

# 圓角矩形 path 輔助
function Get-RoundedRectPath([System.Drawing.Rectangle]$rect, [int]$radius) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $r = $radius
    $x = $rect.X; $y = $rect.Y; $w = $rect.Width; $h = $rect.Height
    $path.StartFigure()
    $path.AddArc($x, $y, $r, $r, 180, 90)
    $path.AddArc($x+$w-$r, $y, $r, $r, 270, 90)
    $path.AddArc($x+$w-$r, $y+$h-$r, $r, $r, 0, 90)
    $path.AddArc($x, $y+$h-$r, $r, $r, 90, 90)
    $path.CloseFigure()
    return $path
}

$size = 512
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::FromArgb(0,0,0,0))
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

# 外框 綠色圓角方塊
$outer = [System.Drawing.Rectangle]::new(16, 16, 480, 480)
$g.FillPath((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(52,211,153))), (Get-RoundedRectPath $outer 110))

# 黑板
$board = [System.Drawing.Rectangle]::new(80, 90, 352, 320)
$g.FillPath((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(10,15,13))), (Get-RoundedRectPath $board 26))

# VA 線
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(234,255,245), 26)
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$g.DrawLine($pen, 150, 170, 196, 320)
$g.DrawLine($pen, 196, 320, 242, 170)
$g.DrawLine($pen, 278, 320, 320, 170)
$g.DrawLine($pen, 320, 170, 362, 320)
$g.DrawLine($pen, 296, 258, 344, 258)

# 粉筆 (白身+綠頭, 旋轉 40°)
$chalkW=150; $chalkH=26
$chalk = New-Object System.Drawing.Bitmap($chalkW, $chalkH)
$gc = [System.Drawing.Graphics]::FromImage($chalk)
$gc.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$gc.Clear([System.Drawing.Color]::FromArgb(0,0,0,0))
$gc.FillPath((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(234,255,245))), (Get-RoundedRectPath ([System.Drawing.Rectangle]::new(0,0,$chalkW,$chalkH)) 13))
$gc.FillPath((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(52,211,153))), (Get-RoundedRectPath ([System.Drawing.Rectangle]::new($chalkW-34,0,34,$chalkH)) 13))
$chalkRot = New-Object System.Drawing.Bitmap($chalkW, $chalkH)
$gcr = [System.Drawing.Graphics]::FromImage($chalkRot)
$gcr.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$gcr.Clear([System.Drawing.Color]::FromArgb(0,0,0,0))
$gcr.TranslateTransform($chalkW/2, $chalkH/2)
$gcr.RotateTransform(40)
$gcr.TranslateTransform(-$chalkW/2, -$chalkH/2)
$gcr.DrawImage($chalk, 0, 0)
$g.DrawImage($chalkRot, 330, 312)

# 板擦 (白身+綠頭, 旋轉 -16°)
$erW=110; $erH=64
$er = New-Object System.Drawing.Bitmap($erW, $erH)
$ge = [System.Drawing.Graphics]::FromImage($er)
$ge.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$ge.Clear([System.Drawing.Color]::FromArgb(0,0,0,0))
$ge.FillPath((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(234,255,245))), (Get-RoundedRectPath ([System.Drawing.Rectangle]::new(0,0,$erW,$erH)) 22))
$ge.FillPath((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(52,211,153))), (Get-RoundedRectPath ([System.Drawing.Rectangle]::new(0,0,$erW,26)) 16))
$erRot = New-Object System.Drawing.Bitmap($erW, $erH)
$ger = [System.Drawing.Graphics]::FromImage($erRot)
$ger.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$ger.Clear([System.Drawing.Color]::FromArgb(0,0,0,0))
$ger.TranslateTransform($erW/2, $erH/2)
$ger.RotateTransform(-16)
$ger.TranslateTransform(-$erW/2, -$erH/2)
$ger.DrawImage($er, 0, 0)
$g.DrawImage($erRot, 92, 300)

$bmp.Save("C:\dev\visual-agent\src-tauri\icons\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "saved clean icon.png (512)"
