package com.example.bing.eqin.fragment.account;

import android.os.Bundle;
import android.support.annotation.NonNull;
import android.support.annotation.Nullable;
import android.support.v4.app.Fragment;
import android.support.v4.app.FragmentManager;
import android.support.v4.app.FragmentTransaction;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;

import com.example.bing.eqin.R;

public class AccountIndexFragment extends Fragment {

    Button btnSignup;

    public AccountIndexFragment(){

    }

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }

    @Nullable
    @Override
    public View onCreateView(@NonNull LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        View view = inflater.inflate(R.layout.fragment_account_index, container, false);

        getActivity().findViewById(R.id.login_toolbar_title).setVisibility(View.VISIBLE);

        final FragmentManager fragmentManager = getActivity().getSupportFragmentManager();


        btnSignup = view.findViewById(R.id.btn_signup);
        btnSignup.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                SignupFragment signupFragment = new SignupFragment();
                FragmentTransaction transaction =  fragmentManager.beginTransaction();
                transaction.replace(R.id.login_container, signupFragment);
                transaction.addToBackStack(null);
                transaction.commit();
            }
        });
        return view;
    }
}
