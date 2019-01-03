package com.example.bing.eqin.model;

public class CartItem {
    public StoreItem getProduct() {
        return product;
    }

    public void setProduct(StoreItem product) {
        this.product = product;
    }

    public int getNum() {
        return num;
    }

    public void setNum(int num) {
        this.num = num;
    }

    private StoreItem product;
    private int num;

    @Override
    public String toString() {
        return ""+getNum()+" "+getProduct().getItemName()+" "+getProduct().getItemPrice();
    }
}
