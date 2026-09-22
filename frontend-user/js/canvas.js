/**
 * 画布管理器
 */
class CanvasManager {
    // 透镜与画布可见边缘之间保留的安全间距
    static EDGE_MARGIN = 8;

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
        // 窗口大小变化：仅重新协调画布尺寸，不改动透镜位置
        window.addEventListener('resize', Utils.debounce(() => {
            this.handleResize();
        }, 100));

        // 重新进入页面（如浏览器前进/后退命中 bfcache）时，重新协调画布与两侧面板
        window.addEventListener('pageshow', () => {
            this.handleResize();
        });
        
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
     * 窗口变化 / 重新进入页面：重新协调画布尺寸
     * 透镜坐标保持不变，网格与缩放由 renderer 自行重算，不受影响
     */
    handleResize() {
        this.renderer.resize();
        this.renderer.setLenses(this.lenses);
    }

    /**
     * 把透镜中心限制在可见画布范围内（拖动已有透镜与从素材库添加共用同一份规则）
     *
     * @param {Lens} lens 待约束的透镜
     * @param {{x:number, y:number}} [desired] 期望的中心坐标，默认为透镜当前坐标
     * @returns {{x:number, y:number, adjusted:boolean, sides:string[]}}
     *          实际坐标；adjusted 表示是否发生了越界收回，sides 标出触碰的边
     */
    constrainLensToBounds(lens, desired = null) {
        const target = desired || { x: lens.x, y: lens.y };
        const { halfWidth, halfHeight } = lens.getBounds();
        const margin = CanvasManager.EDGE_MARGIN;

        const minX = halfWidth + margin;
        const maxX = this.renderer.width - halfWidth - margin;
        const minY = halfHeight + margin;
        const maxY = this.renderer.height - halfHeight - margin;

        const sides = [];
        let x, y;

        // 画布小到放不下整个透镜时退化为居中，避免 min > max 导致翻转
        if (minX >= maxX) {
            x = this.renderer.width / 2;
        } else {
            x = Utils.clamp(target.x, minX, maxX);
            if (target.x < minX) sides.push('左');
            if (target.x > maxX) sides.push('右');
        }

        if (minY >= maxY) {
            y = this.renderer.height / 2;
        } else {
            y = Utils.clamp(target.y, minY, maxY);
            if (target.y < minY) sides.push('上');
            if (target.y > maxY) sides.push('下');
        }

        return { x, y, adjusted: sides.length > 0, sides };
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

        const result = this.constrainLensToBounds(this.selectedLens, {
            x: pos.x - this.dragOffset.x,
            y: pos.y - this.dragOffset.y
        });
        this.selectedLens.x = result.x;
        this.selectedLens.y = result.y;

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

        // 与拖动已有透镜使用同一份越界限制：超出可见范围时自动收回到边界内
        const result = this.constrainLensToBounds(lens, { x: pos.x, y: pos.y });
        lens.x = result.x;
        lens.y = result.y;

        this.addLens(lens);
        this.selectLens(lens);

        if (result.adjusted) {
            const edge = result.sides.join('、');
            Utils.showToast(
                `透镜太靠近${edge}边缘，已自动收回到画布内；如想放到别处，请重新拖入`,
                'warning',
                3000
            );
        } else {
            Utils.showToast('透镜已添加', 'success');
        }
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
