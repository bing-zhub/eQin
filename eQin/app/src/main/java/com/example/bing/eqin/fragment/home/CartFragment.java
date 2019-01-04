package com.example.bing.eqin.fragment.home;

import android.graphics.Color;
import android.os.Bundle;
import android.support.annotation.NonNull;
import android.support.annotation.Nullable;
import android.support.v4.app.Fragment;
import android.support.v4.widget.SwipeRefreshLayout;
import android.support.v7.widget.LinearLayoutManager;
import android.support.v7.widget.RecyclerView;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.TextView;

import com.chad.library.adapter.base.BaseQuickAdapter;
import com.example.bing.eqin.R;
import com.example.bing.eqin.adapter.CartAdapter;
import com.example.bing.eqin.controller.CartController;
import com.example.bing.eqin.model.CartItem;
import com.example.bing.eqin.model.StoreItem;
import com.example.bing.eqin.utils.CommonUtils;
import com.parse.FindCallback;
import com.parse.ParseException;
import com.parse.ParseObject;
import com.parse.ParseQuery;
import com.parse.ParseUser;


import java.util.LinkedList;
import java.util.List;

public class CartFragment extends Fragment{

    private RecyclerView cartContainer;
    private List<CartItem> cartItems;
    private CartAdapter adapter;
    private SwipeRefreshLayout mSwipeRefreshLayout;
    private TextView totalPrice;
    private int totalPriceV;
    private Button confirmButton;

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_cart, container, false);
        cartContainer = view.findViewById(R.id.cart_container);
        totalPrice = view.findViewById(R.id.cart_total);

        confirmButton = view.findViewById(R.id.cart_confirm);
        confirmButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                CommonUtils.showMessage(getContext(), "功能正待开发");
            }
        });

        mSwipeRefreshLayout = view.findViewById(R.id.swipe_refresh);
        mSwipeRefreshLayout.setColorSchemeColors(Color.rgb(47, 223, 189));
        mSwipeRefreshLayout.setOnRefreshListener(new SwipeRefreshLayout.OnRefreshListener() {
            @Override
            public void onRefresh() {
                getData();
                mSwipeRefreshLayout.setRefreshing(false);
                CommonUtils.showMessage(getContext(), "刷新完成");
            }
        });

        cartItems = new LinkedList<>();
        adapter = new CartAdapter(R.layout.item_cart,cartItems);
        adapter.setEnableLoadMore(false);
        adapter.setOnItemChildClickListener(new BaseQuickAdapter.OnItemChildClickListener() {
            @Override
            public void onItemChildClick(BaseQuickAdapter adapter, View view, int position) {
                TextView total = (TextView) adapter.getViewByPosition(position, R.id.cart_item_total);
                TextView remain = (TextView) adapter.getViewByPosition(position, R.id.cart_item_remain);
                TextView price = (TextView) adapter.getViewByPosition(position, R.id.cart_item_price);
                int totalV = Integer.parseInt(total.getText().toString());
                int remainV = Integer.parseInt(remain.getText().toString().replace("剩余: ","").replace("套",""));
                int priceV = Integer.parseInt(price.getText().toString().replace("¥",""));
                if(view.getId()==R.id.cart_item_add){
                    if(remainV==0)
                        return;

                    total.setText((totalV+1)+"");
                    remain.setText("剩余: "+(remainV-1)+"套");
                    totalPrice.setText("合计: "+((totalV+1)*priceV)+"¥");
                } else if(view.getId()==R.id.cart_item_minus){
                    if(totalV==1)
                        return;
                    total.setText((totalV-1)+"");
                    remain.setText("剩余: "+(remainV+1)+"套");
                    totalPrice.setText("合计: "+((totalV-1)*priceV)+"¥");
                } else if(view.getId() == R.id.cart_item_delete){
                    CartController.getInstance().removeFromCart(cartItems.get(position), getContext());
                    adapter.getData().remove(position);
                    adapter.notifyDataSetChanged();
                }
            }
        });

        adapter.bindToRecyclerView(cartContainer);
        cartContainer.setLayoutManager(new LinearLayoutManager(getContext()));


        return view;
    }

    @Override
    public void onHiddenChanged(boolean hidden) {
        if (!hidden)
            getData();
        super.onHiddenChanged(hidden);
    }

    private void getData() {
        cartItems.clear();
        totalPriceV = 0;
        ParseQuery<ParseObject> query = ParseQuery.getQuery("UserCart");
        query.whereEqualTo("User", ParseUser.getCurrentUser());
        query.findInBackground(new FindCallback<ParseObject>() {
            @Override
            public void done(List<ParseObject> objects, ParseException e) {
                if(e==null && objects.size() !=0){
                    for (ParseObject object: objects){
                        CartItem cartItem = new CartItem();
                        cartItem.setNum(object.getInt("Num"));
                        ParseQuery<ParseObject> parseObjectParseQuery = ParseQuery.getQuery("StoreItem");
                        parseObjectParseQuery.whereEqualTo("name", object.getString("Product"));
                        try {
                            List<ParseObject> list =  parseObjectParseQuery.find();
                            if(list.size()!=0){
                                StoreItem item = new StoreItem();
                                ParseObject o =  list.get(0);
                                item.setItemImg(o.getString("img"));
                                item.setItemRemain(o.getInt("remain"));
                                item.setItemName(o.getString("name"));
                                item.setItemPrice(o.getInt("price"));
                                totalPriceV += o.getInt("price") * object.getInt("Num");
                                cartItem.setProduct(item);
                            }
                            cartItems.add(cartItem);
                        } catch (ParseException e1) {
                            e1.printStackTrace();
                        }
                    }
                }
                if(adapter!=null){
                    adapter.notifyDataSetChanged();
                }
            }
        });
        totalPrice.setText("合计: "+totalPriceV+"¥");
    }
}
