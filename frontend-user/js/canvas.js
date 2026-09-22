/**
 * 画布管理器
 */
class CanvasManager {
    constructor() {
        this.canvas = document.getElementById('optics-canvas');
        this.wrapper = document.getElementById('canvas-wrapper');
        this.renderer = new Renderer(this.canvas);
        this.lenses = [];
        this.selectedLens = null;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        
        this.init();
    }
    
    init() {
        this.bindEvents();
        this.handleResize();
    }
    
    bindEvents() {
        // 窗口大小变化
        window.addEventListener('resize', Utils.debounce(() => {
            this.handleResize();
        }, 100));

        // 画布容器尺寸变化（窄屏布局切换、侧边栏伸缩等都会触发）
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(Utils.debounce(() => {
                this.handleResize();
            }, 100));
            this.resizeObserver.observe(this.wrapper);
        }
        
        // 鼠标事件
        this.canvas.addEventListener('mousedown', (e) => this.handlePointerDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handlePointerMove(e));
        this.canvas.addEventListener('mouseup', () => this.handlePointerUp());
        this.canvas.addEventListener('mouseleave', () => this.handlePointerUp());
        
        // 触摸事件 - 关键：正确处理触摸
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.handlePointerDown(e);
        }, { passive: false });
        
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            this.handlePointerMove(e);
        }, { passive: false });
        
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.handlePointerUp();
        }, { passive: false });
        
        this.canvas.addEventListener('touchcancel', () => this.handlePointerUp());
        
        // 拖放事件（桌面端）
        this.wrapper.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.wrapper.addEventListener('dragleave', () => this.handleDragLeave());
        this.wrapper.addEventListener('drop', (e) => this.handleDrop(e));
    }
    
    /**
     * 获取指针位置（兼容鼠标和触摸）
     */
    getPointerPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        let clientX, clientY;
        
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else if (e.changedTouches && e.changedTouches.length > 0) {
            clientX = e.changedTouches[0].clientX;
            clientY = e.changedTouches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }
        
        // 计算相对于画布的位置
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        
        return { x, y };
    }
    
    /**
     * 窗口或容器尺寸变化：
     * 仅让画布与两侧面板重新协调（重设分辨率并重绘网格/光轴），
     * 透镜坐标保持不变，网格间距与渲染比例也不受影响。
     */
    handleResize() {
        this.renderer.resize();
    }

    /**
     * 将透镜位置限制在画布可见范围内（拖动与从素材库添加共用这一份限制）。
     * 边界依据透镜自身的交互占位尺寸，而不是固定常量。
     * 返回是否发生了越界收回。
     */
    constrainLensPosition(lens, x, y) {
        const width = this.renderer.width;
        const height = this.renderer.height;

        // 画布过窄/过矮时退化为中线，避免 min > max
        const marginX = Math.min(lens.getHitHalfWidth(), width / 2);
        const marginY = Math.min(lens.getHitHalfHeight(), height / 2);

        const minX = marginX;
        const maxX = width - marginX;
        const minY = marginY;
        const maxY = height - marginY;

        const constrainedX = Utils.clamp(x, minX, maxX);
        const constrainedY = Utils.clamp(y, minY, maxY);

        const wasOutOfBounds = constrainedX !== x || constrainedY !== y;

        lens.x = constrainedX;
        lens.y = constrainedY;

        return wasOutOfBounds;
    }
    
    handlePointerDown(e) {
        const pos = this.getPointerPos(e);
        const lens = this.renderer.getLensAtPoint(pos.x, pos.y);
        
        if (lens) {
            this.selectLens(lens);
            this.isDragging = true;
            this.dragOffset = {
                x: pos.x - lens.x,
                y: pos.y - lens.y
            };
        } else {
            this.deselectLens();
        }
    }
    
    handlePointerMove(e) {
        if (!this.isDragging || !this.selectedLens) return;

        const pos = this.getPointerPos(e);

        this.constrainLensPosition(
            this.selectedLens,
            pos.x - this.dragOffset.x,
            pos.y - this.dragOffset.y
        );

        this.renderer.render();
    }
    
    handlePointerUp() {
        this.isDragging = false;
    }
    
    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        document.getElementById('canvas-drop-hint').classList.remove('hidden');
    }
    
    handleDragLeave() {
        document.getElementById('canvas-drop-hint').classList.add('hidden');
    }
    
    handleDrop(e) {
        e.preventDefault();
        document.getElementById('canvas-drop-hint').classList.add('hidden');

        const lensType = e.dataTransfer.getData('lens-type');
        const material = e.dataTransfer.getData('lens-material');

        if (!lensType) return;

        const pos = this.getPointerPos(e);

        const lens = new Lens({
            type: lensType,
            x: pos.x,
            y: pos.y,
            material: material || 'normal'
        });

        // 与拖动已有透镜共用同一份越界限制，越界时收回边界内
        const wasOutOfBounds = this.placeLibraryLens(lens);

        if (wasOutOfBounds) {
            Utils.showToast('透镜超出画布可见范围，已自动收回边界内，可重新拖动调整', 'warning', 3000);
        } else {
            Utils.showToast('透镜已添加', 'success');
        }
    }

    /**
     * 放置从素材库添加的透镜（拖放与触屏点击共用）。
     * 位置先经过可见范围限制，再加入画布并选中。
     * 返回是否发生了越界收回。
     */
    placeLibraryLens(lens) {
        const wasOutOfBounds = this.constrainLensPosition(lens, lens.x, lens.y);

        this.addLens(lens);
        this.selectLens(lens);

        return wasOutOfBounds;
    }
    
    addLens(lens) {
        this.lenses.push(lens);
        this.renderer.setLenses(this.lenses);
    }
    
    removeLens(lens) {
        const index = this.lenses.indexOf(lens);
        if (index > -1) {
            this.lenses.splice(index, 1);
            if (this.selectedLens === lens) {
                this.deselectLens();
            }
            this.renderer.setLenses(this.lenses);
        }
    }
    
    selectLens(lens) {
        if (this.selectedLens) {
            this.selectedLens.selected = false;
        }
        
        this.selectedLens = lens;
        lens.selected = true;
        this.renderer.render();
        
        window.dispatchEvent(new CustomEvent('lensSelected', { detail: lens }));
    }
    
    deselectLens() {
        if (this.selectedLens) {
            this.selectedLens.selected = false;
            this.selectedLens = null;
            this.renderer.render();
        }
        
        window.dispatchEvent(new CustomEvent('lensDeselected'));
    }
    
    clear() {
        this.lenses = [];
        this.selectedLens = null;
        this.isDragging = false;
        this.renderer.setLenses([]);
        this.renderer.render();
    }
    
    getRenderer() {
        return this.renderer;
    }
}
